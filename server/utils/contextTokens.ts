import { Worker } from 'node:worker_threads'
import { findPackageJSON } from 'node:module'
import { pathToFileURL } from 'node:url'
import { LMStudioClient } from '@lmstudio/sdk'
import { normalizeLocalBaseUrl, type LlmProxySettings } from './llm.ts'

type TextMessage = { role: 'system' | 'user' | 'assistant'; content: string }

const contextErrors = {
  sdk_unavailable: 'No se pudo localizar el SDK de LM Studio incluido en la aplicación. Revisa que la instalación esté completa.',
  api_token: 'El token configurado no es un token API válido de LM Studio. Sustitúyelo en Ajustes o bórralo si el servidor no exige autenticación.',
  model_not_loaded: 'El modelo configurado no está cargado en LM Studio. Cárgalo desde Ajustes o selecciona el modelo que tienes cargado.',
  prompt_template: 'LM Studio no pudo aplicar la plantilla del modelo al contexto. Revisa su plantilla de conversación.',
  tokenizer: 'LM Studio no pudo contar los tokens del modelo configurado. Revisa su tokenizer.',
  capacity: 'LM Studio no pudo consultar la capacidad de contexto del modelo cargado.',
  connection: 'No se pudieron medir los tokens con LM Studio. Comprueba la conexión y el token del servidor.'
} as const

export class ContextMeasurementError extends Error {
  code: keyof typeof contextErrors

  constructor(code: keyof typeof contextErrors) {
    super(contextErrors[code])
    this.name = 'ContextMeasurementError'
    this.code = code
  }
}

export function resolveLmStudioSdkUrl(base = import.meta.url) {
  try {
    const packagePath = findPackageJSON('@lmstudio/sdk', base)
    if (!packagePath) throw new Error('Paquete no encontrado.')
    // Nitro incluye la entrada ESM usada por la importación estática, no la entrada CJS.
    return new URL('./dist/index.mjs', pathToFileURL(packagePath)).href
  } catch {
    throw new ContextMeasurementError('sdk_unavailable')
  }
}

// Ejecutada dentro del worker: no depende del ámbito del módulo ni registra credenciales.
export async function measureLoadedContext(Client: typeof LMStudioClient, data: {
  baseUrl: string; apiToken: string; model: string; messages?: TextMessage[]
}) {
  let stage = data.apiToken ? 'api_token' : 'connection'
  let client: LMStudioClient | undefined
  try {
    client = new Client({ baseUrl: data.baseUrl, ...(data.apiToken ? { apiToken: data.apiToken } : {}) })
    stage = 'connection'
    const loaded = await client.llm.listLoaded()
    const model = loaded.find(item => item.identifier === data.model)
      ?? loaded.find(item => item.modelKey === data.model || item.path === data.model)
    if (!model) {
      stage = 'model_not_loaded'
      throw new Error('El modelo configurado no está cargado en LM Studio.')
    }
    let tokens = 0
    if (data.messages) {
      stage = 'prompt_template'
      // Algunas plantillas exigen un turno de usuario para medir historias narradas solo por IA.
      // El turno vacío solo se usa al formatear; no modifica ni guarda el historial.
      const templateMessages: TextMessage[] = data.messages.some(message => message.role === 'user')
        ? data.messages : [...data.messages, { role: 'user', content: '' }]
      const formatted = await model.applyPromptTemplate(templateMessages)
      stage = 'tokenizer'
      tokens = await model.countTokens(formatted)
      if (!Number.isInteger(tokens) || tokens < 0) throw new Error('Medición de tokens no válida.')
    }
    stage = 'capacity'
    const capacity = await model.getContextLength()
    if (!Number.isInteger(capacity) || capacity <= 0) throw new Error('Capacidad de contexto no válida.')
    return { tokens, capacity, model: model.identifier }
  } catch (caught) {
    throw Object.assign(new Error(stage === 'model_not_loaded' ? 'El modelo configurado no está cargado en LM Studio.' : 'No se pudo medir el contexto.'), { code: stage, cause: caught })
  } finally {
    await client?.[Symbol.asyncDispose]()
  }
}

export function measureLmStudioContext(settings: LlmProxySettings, model: string, messages: TextMessage[] | undefined, signal?: AbortSignal, timeoutMs = 30_000) {
  signal?.throwIfAborted()
  const url = new URL(normalizeLocalBaseUrl(settings.baseUrl))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  // La importación estática permite a Nitro incluir el SDK externo y sus dependencias.
  if (typeof LMStudioClient !== 'function') throw new Error('SDK de LM Studio no disponible.')
  const workerEnvironment = { ...process.env }
  delete workerEnvironment.LM_API_TOKEN
  return new Promise<{ tokens: number; capacity: number; model: string }>((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const measure = ${measureLoadedContext.toString()};
      import(workerData.sdkUrl).then(({ LMStudioClient }) => measure(LMStudioClient, workerData))
        .then(value => parentPort.postMessage({ value }))
        .catch(error => parentPort.postMessage({ error: true, code: error.code }));
    `, {
      eval: true, execArgv: [], env: workerEnvironment,
      workerData: {
        sdkUrl: resolveLmStudioSdkUrl(),
        baseUrl: url.href.replace(/\/+$/, ''),
        apiToken: typeof settings.apiKey === 'string' ? settings.apiKey.replace(/[\r\n]/g, '').trim() : '',
        model: model.trim(), messages
      }
    })
    let settled = false
    const finish = (error?: Error, value?: { tokens: number; capacity: number; model: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      void worker.terminate()
      if (error) reject(error)
      else resolve(value!)
    }
    const failure = (code?: string) => new ContextMeasurementError(
      code && Object.hasOwn(contextErrors, code) ? code as keyof typeof contextErrors : 'connection'
    )
    const abort = () => finish(new DOMException('Petición cancelada', 'AbortError'))
    const timer = setTimeout(() => finish(failure()), timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    worker.once('message', (result) => result.value ? finish(undefined, result.value) : finish(failure(result.code)))
    worker.once('error', () => finish(failure()))
    worker.once('exit', () => { if (!settled) finish(failure()) })
    if (signal?.aborted) abort()
  })
}
