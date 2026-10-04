import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { LMStudioClient } from '@lmstudio/sdk'
import { normalizeLocalBaseUrl, type LlmProxySettings } from './llm.ts'

type TextMessage = { role: 'system' | 'user' | 'assistant'; content: string }

const contextErrors = {
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

// Ejecutada dentro del worker: no depende del ámbito del módulo ni registra credenciales.
export async function measureLoadedContext(Client: typeof LMStudioClient, data: {
  baseUrl: string; apiToken: string; model: string; messages: TextMessage[]
}) {
  let stage = 'connection'
  const client = new Client({ baseUrl: data.baseUrl, ...(data.apiToken ? { apiToken: data.apiToken } : {}) })
  try {
    const loaded = await client.llm.listLoaded()
    const model = loaded.find(item => item.identifier === data.model)
      ?? loaded.find(item => item.modelKey === data.model || item.path === data.model)
    if (!model) {
      stage = 'model_not_loaded'
      throw new Error('El modelo configurado no está cargado en LM Studio.')
    }
    stage = 'prompt_template'
    const formatted = await model.applyPromptTemplate(data.messages)
    stage = 'tokenizer'
    const tokens = await model.countTokens(formatted)
    stage = 'capacity'
    return { tokens, capacity: await model.getContextLength(), model: model.identifier }
  } catch (caught) {
    throw Object.assign(new Error(stage === 'model_not_loaded' ? 'El modelo configurado no está cargado en LM Studio.' : 'No se pudo medir el contexto.'), { code: stage, cause: caught })
  } finally {
    await client[Symbol.asyncDispose]()
  }
}

export function measureLmStudioContext(settings: LlmProxySettings, model: string, messages: TextMessage[], signal?: AbortSignal, timeoutMs = 30_000) {
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
        sdkUrl: pathToFileURL(createRequire(import.meta.url).resolve('@lmstudio/sdk')).href,
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
