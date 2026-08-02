export interface LlmCallError extends Error {
  status?: number
  detail?: string
}

export interface LlmChatRequest {
  model: string
  messages: Array<{ role: string; content: string }>
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
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
      statusMessage?: string
      data?: { detail?: string }
      detail?: string
    }
  }
  if (error.name === 'AbortError' || error.cause?.name === 'AbortError') {
    return Object.assign(new Error('Petición cancelada'), { name: 'AbortError' })
  }
  return Object.assign(
    new Error(error.data?.statusMessage || error.statusMessage || error.message || 'Fallo del modelo'),
    {
      status: error.statusCode ?? error.data?.statusCode,
      detail: error.data?.data?.detail ?? error.data?.detail
    }
  )
}

export async function fetchLlmModels(): Promise<string[]> {
  try {
    return await $fetch<string[]>('/api/llm/models')
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
        maxTokens: request.maxTokens ?? 800
      },
      signal: request.signal
    })
  } catch (caught) {
    throw normalizeError(caught)
  }
}
