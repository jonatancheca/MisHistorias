import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { LMStudioClient } from '@lmstudio/sdk'
import { normalizeLocalBaseUrl, type LlmProxySettings } from './llm.ts'

type TextMessage = { role: 'system' | 'user' | 'assistant'; content: string }

// Ejecutada dentro del worker: no depende del ámbito del módulo ni registra credenciales.
export async function measureLoadedContext(Client: typeof LMStudioClient, data: {
  baseUrl: string; apiToken: string; model: string; messages: TextMessage[]
}) {
  const client = new Client({ baseUrl: data.baseUrl, ...(data.apiToken ? { apiToken: data.apiToken } : {}) })
  try {
    const loaded = await client.llm.listLoaded()
    const model = loaded.find(item => item.identifier === data.model)
      ?? loaded.find(item => item.modelKey === data.model || item.path === data.model)
    if (!model) throw new Error('El modelo configurado no está cargado en LM Studio.')
    const formatted = await model.applyPromptTemplate(data.messages)
    return { tokens: await model.countTokens(formatted), capacity: await model.getContextLength(), model: model.identifier }
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
        .catch(() => parentPort.postMessage({ error: true }));
    `, {
      eval: true, execArgv: [], env: workerEnvironment,
      workerData: {
        sdkUrl: pathToFileURL(createRequire(import.meta.url).resolve('@lmstudio/sdk')).href,
        baseUrl: url.href.replace(/\/+$/, ''),
        apiToken: typeof settings.apiKey === 'string' ? settings.apiKey.replace(/[\r\n]/g, '').trim() : '',
        model, messages
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
    const failure = () => new Error('No se pudieron medir los tokens con LM Studio. Comprueba la conexión, el token y que el modelo configurado esté cargado y permita usar su tokenizer.')
    const abort = () => finish(new DOMException('Petición cancelada', 'AbortError'))
    const timer = setTimeout(() => finish(failure()), timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    worker.once('message', (result) => result.value ? finish(undefined, result.value) : finish(failure()))
    worker.once('error', () => finish(failure()))
    worker.once('exit', () => { if (!settled) finish(failure()) })
    if (signal?.aborted) abort()
  })
}
