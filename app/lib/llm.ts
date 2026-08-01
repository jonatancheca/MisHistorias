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

const LOOPBACK_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^\[?::1\]?$/
]

type LocalAddressSpace = 'local' | 'loopback'
type LocalRequestInit = RequestInit & { targetAddressSpace?: LocalAddressSpace }

export interface LlmCallError extends Error {
  status?: number
  detail?: string
}

export interface LlmChatRequest {
  baseUrl: string
  apiKey?: string
  model: string
  messages: Array<{ role: string; content: string }>
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: unknown }
    finish_reason?: unknown
  }>
}

export function stripThinkingBlocks(content: string) {
  return content
    .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '')
    .replace(/<think\b[^>]*>[\s\S]*$/gi, '')
    .trim()
}

export function normalizeLocalBaseUrl(rawBaseUrl: unknown): string {
  if (typeof rawBaseUrl !== 'string' || rawBaseUrl.trim() === '') {
    throw new Error('Falta la URL del modelo')
  }

  let url: URL
  try {
    url = new URL(rawBaseUrl.trim())
  } catch {
    throw new Error('URL del modelo no válida')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('La URL debe usar http o https')
  }
  if (!PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))) {
    throw new Error('Solo se permiten servidores locales o de red privada')
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

function authHeader(rawApiKey: unknown): Record<string, string> {
  if (typeof rawApiKey !== 'string') return {}
  const token = rawApiKey.replace(/[\r\n]/g, '').trim()
  return token ? { authorization: `Bearer ${token}` } : {}
}

function localRequestInit(baseUrl: string, init: RequestInit): LocalRequestInit {
  const hostname = new URL(baseUrl).hostname
  const targetAddressSpace = LOOPBACK_HOST_PATTERNS.some((pattern) => pattern.test(hostname))
    ? 'loopback'
    : 'local'
  return { ...init, targetAddressSpace }
}

function llmError(message: string, status?: number, detail?: string): LlmCallError {
  return Object.assign(new Error(message), {
    status,
    detail: detail?.slice(0, 500) || undefined
  })
}

async function responseError(response: Response): Promise<LlmCallError> {
  const detail = await response.text().catch(() => '')
  const message =
    response.status === 401 || response.status === 403
      ? 'El servidor rechazó el token de acceso'
      : `El servidor del modelo respondió ${response.status}`
  return llmError(message, response.status, detail)
}

function connectionError(caught: unknown): LlmCallError {
  if ((caught as Error)?.name === 'AbortError') return caught as LlmCallError
  return llmError(
    'No se pudo conectar con LM Studio. Comprueba la URL, CORS, el permiso de red local y que el servidor esté iniciado.'
  )
}

export async function fetchLlmModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  const normalizedBaseUrl = normalizeLocalBaseUrl(baseUrl)
  let response: Response
  try {
    response = await fetch(
      `${normalizedBaseUrl}/v1/models`,
      localRequestInit(normalizedBaseUrl, {
        headers: { accept: 'application/json', ...authHeader(apiKey) },
        signal: AbortSignal.timeout(10_000)
      })
    )
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

export async function fetchLlmChat(request: LlmChatRequest) {
  const normalizedBaseUrl = normalizeLocalBaseUrl(request.baseUrl)
  if (!request.messages.length) throw llmError('Faltan mensajes')
  if (!request.model) throw llmError('Falta el modelo')

  let response: Response
  try {
    response = await fetch(
      `${normalizedBaseUrl}/v1/chat/completions`,
      localRequestInit(normalizedBaseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(request.apiKey) },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature ?? 0.8,
          max_tokens: request.maxTokens ?? 800,
          stream: false
        }),
        signal: request.signal
      })
    )
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
