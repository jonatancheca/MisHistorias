const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
  /\.local$/i,
  /^host\.docker\.internal$/i
]

export interface LlmProxySettings {
  baseUrl: string
  apiKey: string
}

export interface LlmProxyRequest {
  model: string
  messages: Array<{ role: string; content: string }>
  temperature: number
  maxTokens: number
  /** Desactiva el canal de razonamiento en LM Studio / modelos thinking. */
  disableReasoning?: boolean
  signal?: AbortSignal
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown
      reasoning_content?: unknown
      reasoning?: unknown
    }
    finish_reason?: unknown
  }>
}

export interface LlmProxyError extends Error {
  status?: number
  detail?: string
}

export function stripThinkingBlocks(content: string) {
  return content
    .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '')
    .replace(/<think\b[^>]*>[\s\S]*$/gi, '')
    .replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning\s*>/gi, '')
    .trim()
}

export function extractAssistantText(message: {
  content?: unknown
  reasoning_content?: unknown
  reasoning?: unknown
} | null | undefined) {
  const content = typeof message?.content === 'string' ? message.content.trim() : ''
  if (content) return stripThinkingBlocks(content)
  const reasoningContent =
    typeof message?.reasoning_content === 'string' ? message.reasoning_content.trim() : ''
  if (reasoningContent) return stripThinkingBlocks(reasoningContent)
  const reasoning = typeof message?.reasoning === 'string' ? message.reasoning.trim() : ''
  if (reasoning) return stripThinkingBlocks(reasoning)
  return ''
}

export function normalizeLocalBaseUrl(rawBaseUrl: unknown): string {
  if (typeof rawBaseUrl !== 'string' || rawBaseUrl.trim() === '') {
    throw llmError('Falta la URL del modelo')
  }
  let url: URL
  try {
    url = new URL(rawBaseUrl.trim())
  } catch {
    throw llmError('URL del modelo no válida')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw llmError('La URL debe usar http o https')
  }
  if (!PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))) {
    throw llmError('Solo se permiten servidores locales o de red privada')
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

function authHeader(rawApiKey: unknown): Record<string, string> {
  if (typeof rawApiKey !== 'string') return {}
  const token = rawApiKey.replace(/[\r\n]/g, '').trim()
  return token ? { authorization: `Bearer ${token}` } : {}
}

function llmError(message: string, status?: number, detail?: string): LlmProxyError {
  return Object.assign(new Error(message), {
    status,
    detail: detail?.slice(0, 500) || undefined
  })
}

async function responseError(response: Response): Promise<LlmProxyError> {
  const detail = await response.text().catch(() => '')
  const message =
    response.status === 401 || response.status === 403
      ? 'El servidor rechazó el token de acceso'
      : `El servidor del modelo respondió ${response.status}`
  return llmError(message, response.status, detail)
}

function connectionError(caught: unknown): LlmProxyError {
  if ((caught as Error)?.name === 'AbortError') return caught as LlmProxyError
  return llmError('No se pudo conectar con LM Studio. Comprueba la URL y que el servidor esté iniciado.')
}

export async function fetchProxyModels(settings: LlmProxySettings): Promise<string[]> {
  const baseUrl = normalizeLocalBaseUrl(settings.baseUrl)
  let response: Response
  try {
    response = await fetch(`${baseUrl}/v1/models`, {
      headers: { accept: 'application/json', ...authHeader(settings.apiKey) },
      signal: AbortSignal.timeout(10_000)
    })
  } catch (caught) {
    throw connectionError(caught)
  }
  if (!response.ok) throw await responseError(response)
  try {
    const payload = (await response.json()) as { data?: Array<{ id?: string }> }
    return (payload.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string')
  } catch {
    throw llmError('El servidor del modelo devolvió una respuesta no válida')
  }
}

export async function fetchProxyChat(settings: LlmProxySettings, request: LlmProxyRequest) {
  const baseUrl = normalizeLocalBaseUrl(settings.baseUrl)
  if (!request.messages.length) throw llmError('Faltan mensajes')
  if (!request.model) throw llmError('Falta el modelo')

  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: request.maxTokens,
    stream: false
  }
  // LM Studio / modelos thinking: sin esto, max_tokens se gasta en reasoning_content
  // y content llega vacío (finish_reason=length).
  if (request.disableReasoning !== false) {
    body.reasoning_effort = 'none'
    body.reasoning = 'off'
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(settings.apiKey) },
      body: JSON.stringify(body),
      signal: request.signal
    })
  } catch (caught) {
    throw connectionError(caught)
  }
  if (!response.ok) throw await responseError(response)

  let completion: ChatCompletionResponse
  try {
    completion = (await response.json()) as ChatCompletionResponse
  } catch {
    throw llmError('El servidor del modelo devolvió una respuesta no válida')
  }
  const choice = completion.choices?.[0]
  const content = extractAssistantText(choice?.message)
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null
  if (!content) {
    throw llmError(
      finishReason === 'length'
        ? 'El modelo agotó tokens en razonamiento y no devolvió JSON. Sube max_tokens o desactiva Thinking en LM Studio.'
        : 'El modelo devolvió content vacío'
    )
  }
  return { content, finishReason }
}
