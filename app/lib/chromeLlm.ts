/// <reference types="dom-chromium-ai" />

import { reportClientErrorTrace } from './errorTraces.ts'

export type ChromeLlmAvailability = Availability

export interface ChromeLlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChromeLlmRequest {
  messages: ChromeLlmMessage[]
  operation?: string
  signal?: AbortSignal
  onDownloadProgress?: (percent: number) => void
}

export interface ChromeLlmError extends Error {
  detail?: string
}

const LANGUAGE_MODEL_OPTIONS: LanguageModelCreateCoreOptions = {
  expectedInputs: [{ type: 'text', languages: ['es'] }],
  expectedOutputs: [{ type: 'text', languages: ['es'] }]
}

function getLanguageModelApi() {
  return typeof LanguageModel === 'undefined' ? null : LanguageModel
}

function chromeError(message: string, detail?: string): ChromeLlmError {
  return Object.assign(new Error(message), { detail })
}

function normalizeChromeError(caught: unknown): ChromeLlmError {
  const source = caught as { name?: string; message?: string }
  if (source.name === 'AbortError') {
    return Object.assign(new Error('Petición cancelada'), { name: 'AbortError' })
  }
  if (source.name === 'QuotaExceededError') {
    return chromeError(
      'La historia supera el contexto disponible de la IA local de Chrome. Reduce el historial en Ajustes.',
      source.message
    )
  }
  if (source.name === 'NotSupportedError') {
    return chromeError(
      'La IA local de Chrome no admite este dispositivo, navegador o idioma.',
      source.message
    )
  }
  if (source.name === 'SecurityError') {
    return chromeError('Chrome ha bloqueado el acceso a su IA local.', source.message)
  }
  return chromeError(
    source.message
      ? `No se pudo usar la IA local de Chrome: ${source.message}`
      : 'No se pudo usar la IA local de Chrome.',
    source.message
  )
}

function createOptions(
  signal?: AbortSignal,
  onDownloadProgress?: (percent: number) => void
): LanguageModelCreateOptions {
  return {
    ...LANGUAGE_MODEL_OPTIONS,
    signal,
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', (event) => {
        onDownloadProgress?.(Math.round(Math.max(0, Math.min(1, event.loaded)) * 100))
      })
    }
  }
}

export function normalizeChromeMessages(messages: ChromeLlmMessage[]): ChromeLlmMessage[] {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n')
  const conversation: ChromeLlmMessage[] = messages.flatMap((message) =>
    message.role === 'system'
      ? []
      : [{ role: message.role, content: message.content }]
  )

  return system
    ? [{ role: 'system', content: system }, ...conversation]
    : conversation
}

export async function getChromeLlmAvailability(): Promise<ChromeLlmAvailability> {
  const api = getLanguageModelApi()
  if (!api) return 'unavailable'
  try {
    return await api.availability(LANGUAGE_MODEL_OPTIONS)
  } catch (caught) {
    const error = normalizeChromeError(caught)
    if (error.name !== 'AbortError') {
      void reportClientErrorTrace({
        source: 'llm',
        operation: 'chrome.availability',
        message: error.message,
        requestSent: false,
        request: LANGUAGE_MODEL_OPTIONS,
        response: caught,
        stack: error.stack
      })
    }
    throw error
  }
}

export async function prepareChromeLlm(options: {
  signal?: AbortSignal
  onDownloadProgress?: (percent: number) => void
} = {}) {
  const api = getLanguageModelApi()
  if (!api || await getChromeLlmAvailability() === 'unavailable') {
    const error = chromeError('La IA local de Chrome no está disponible en este navegador o equipo.')
    void reportClientErrorTrace({
      source: 'llm', operation: 'chrome.prepare', message: error.message,
      requestSent: false, request: LANGUAGE_MODEL_OPTIONS, response: null, stack: error.stack
    })
    throw error
  }

  let session: LanguageModel | null = null
  try {
    session = await api.create(createOptions(options.signal, options.onDownloadProgress))
  } catch (caught) {
    const error = normalizeChromeError(caught)
    if (error.name !== 'AbortError') {
      void reportClientErrorTrace({
        source: 'llm', operation: 'chrome.prepare', message: error.message,
        requestSent: false, request: LANGUAGE_MODEL_OPTIONS, response: caught, stack: error.stack
      })
    }
    throw error
  } finally {
    session?.destroy()
  }
}

export async function fetchChromeLlmChat(request: ChromeLlmRequest) {
  const api = getLanguageModelApi()
  const operation = request.operation || 'chrome.chat'
  if (!api || await getChromeLlmAvailability() === 'unavailable') {
    const error = chromeError('La IA local de Chrome no está disponible en este navegador o equipo.')
    void reportClientErrorTrace({
      source: 'llm', operation, message: error.message, requestSent: false,
      request: { messages: request.messages }, response: null, stack: error.stack
    })
    throw error
  }

  let session: LanguageModel | null = null
  try {
    session = await api.create(createOptions(request.signal, request.onDownloadProgress))
    const prompt = normalizeChromeMessages(request.messages) as unknown as LanguageModelPrompt
    const content = await session.prompt(prompt, { signal: request.signal })
    if (!content.trim()) {
      void reportClientErrorTrace({
        source: 'llm', operation, message: 'El modelo no devolvió contenido visible.',
        requestSent: true, request: { messages: request.messages }, response: { content }
      })
    }
    return { content, finishReason: null }
  } catch (caught) {
    const error = normalizeChromeError(caught)
    if (error.name !== 'AbortError') {
      void reportClientErrorTrace({
        source: 'llm', operation, message: error.message, requestSent: null,
        request: { messages: request.messages }, response: caught, stack: error.stack
      })
    }
    throw error
  } finally {
    session?.destroy()
  }
}
