import { getActiveDataScope, type DataScope } from './db.ts'

export interface LlmCallError extends Error {
  status?: number
  detail?: string
}

export interface LlmChatRequest {
  model: string
  messages: LlmMessage[]
  operation?: string
  temperature?: number
  maxTokens?: number
  scope?: DataScope
  signal?: AbortSignal
}

export type LlmMessageContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
>

export interface LlmMessage {
  role: string
  content: LlmMessageContent
}

function normalizeError(caught: unknown): LlmCallError {
  const error = caught as {
    name?: string
    message?: string
    statusCode?: number
    statusMessage?: string
    cause?: { name?: string }
    data?: {
      statusCode?: number
      message?: string
      statusMessage?: string
      data?: { detail?: string }
      detail?: string
    }
  }
  if (error.name === 'AbortError' || error.cause?.name === 'AbortError') {
    return Object.assign(new Error('Petición cancelada'), { name: 'AbortError' })
  }
  return Object.assign(
    new Error(
      error.data?.message || error.data?.statusMessage || error.statusMessage || error.message ||
      'Fallo del modelo'
    ),
    {
      status: error.statusCode ?? error.data?.statusCode,
      detail: error.data?.data?.detail ?? error.data?.detail
    }
  )
}

export async function fetchLlmModels(scope: DataScope = getActiveDataScope()): Promise<string[]> {
  try {
    return await $fetch<string[]>('/api/llm/models', { query: { scope } })
  } catch (caught) {
    throw normalizeError(caught)
  }
}

export async function preloadLlmModel(scope: DataScope = getActiveDataScope()) {
  try {
    return await $fetch<{ status: 'loaded' | 'already-loaded'; instanceId: string }>(
      '/api/llm/model-management',
      { method: 'POST', body: { action: 'load', scope } }
    )
  } catch (caught) {
    throw normalizeError(caught)
  }
}

export async function unloadAllLlmModels(scope: DataScope = getActiveDataScope()) {
  try {
    return await $fetch<{
      total: number
      unloaded: number
      failed: Array<{ instanceId: string; message: string }>
    }>('/api/llm/model-management', {
      method: 'POST',
      body: { action: 'unload-all', scope }
    })
  } catch (caught) {
    throw normalizeError(caught)
  }
}

export async function fetchLlmChat(request: LlmChatRequest) {
  try {
    return await $fetch<{ content: string; finishReason: string | null }>('/api/llm/chat', {
      method: 'POST',
      body: {
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.8,
        maxTokens: request.maxTokens ?? 800,
        scope: request.scope ?? getActiveDataScope(),
        operation: request.operation
      },
      signal: request.signal
    })
  } catch (caught) {
    throw normalizeError(caught)
  }
}
