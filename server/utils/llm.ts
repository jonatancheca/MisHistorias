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
  messages: Array<{ role: string; content: LlmMessageContent }>
  temperature: number
  maxTokens: number
  signal?: AbortSignal
}

export type LlmMessageContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
>

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: unknown }
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
    .trim()
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

  let response: Response
  try {
    response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(settings.apiKey) },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: false
      }),
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
  const content =
    typeof choice?.message?.content === 'string' ? stripThinkingBlocks(choice.message.content) : ''
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null
  return { content, finishReason }
}
