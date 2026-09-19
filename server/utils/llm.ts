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
  diagnostic?: LlmProxyDiagnostic
}

export interface LlmProxyDiagnostic {
  request: unknown
  requestSent: boolean | null
  response: { status: number; body: unknown } | null
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

function llmError(
  message: string,
  status?: number,
  detail?: string,
  diagnostic?: LlmProxyDiagnostic
): LlmProxyError {
  return Object.assign(new Error(message), {
    status,
    detail: detail?.slice(0, 500) || undefined,
    diagnostic
  })
}

function responseError(response: Response, detail: string, request: unknown): LlmProxyError {
  const message =
    response.status === 401 || response.status === 403
      ? 'El servidor rechazó el token de acceso'
      : `El servidor del modelo respondió ${response.status}`
  return llmError(message, response.status, detail, {
    request,
    requestSent: true,
    response: { status: response.status, body: detail }
  })
}

function connectionError(caught: unknown, request?: unknown): LlmProxyError {
  if ((caught as Error)?.name === 'AbortError') return caught as LlmProxyError
  return llmError(
    'No se pudo conectar con LM Studio. Comprueba la URL y que el servidor esté iniciado.',
    undefined,
    undefined,
    request ? { request, requestSent: null, response: null } : undefined
  )
}

export async function fetchProxyModels(settings: LlmProxySettings): Promise<string[]> {
  const baseUrl = normalizeLocalBaseUrl(settings.baseUrl)
  const url = `${baseUrl}/v1/models`
  const headers = { accept: 'application/json', ...authHeader(settings.apiKey) }
  const diagnosticRequest = { url, method: 'GET', headers }
  let response: Response
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10_000)
    })
  } catch (caught) {
    throw connectionError(caught, diagnosticRequest)
  }
  const raw = await response.text().catch(() => '')
  if (!response.ok) throw responseError(response, raw, diagnosticRequest)
  try {
    const payload = JSON.parse(raw) as { data?: Array<{ id?: string }> }
    return (payload.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string')
  } catch {
    throw llmError('El servidor del modelo devolvió una respuesta no válida', response.status, raw, {
      request: diagnosticRequest,
      requestSent: true,
      response: { status: response.status, body: raw }
    })
  }
}

export async function fetchProxyChat(settings: LlmProxySettings, request: LlmProxyRequest) {
  const baseUrl = normalizeLocalBaseUrl(settings.baseUrl)
  if (!request.messages.length) throw llmError('Faltan mensajes')
  if (!request.model) throw llmError('Falta el modelo')

  const url = `${baseUrl}/v1/chat/completions`
  const headers = { 'content-type': 'application/json', ...authHeader(settings.apiKey) }
  const body = {
    model: request.model,
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: request.maxTokens,
    stream: false
  }
  const diagnosticRequest = { url, method: 'POST', headers, body }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: request.signal
    })
  } catch (caught) {
    throw connectionError(caught, diagnosticRequest)
  }
  const raw = await response.text().catch(() => '')
  if (!response.ok) throw responseError(response, raw, diagnosticRequest)

  let completion: ChatCompletionResponse
  try {
    completion = JSON.parse(raw) as ChatCompletionResponse
  } catch {
    throw llmError('El servidor del modelo devolvió una respuesta no válida', response.status, raw, {
      request: diagnosticRequest,
      requestSent: true,
      response: { status: response.status, body: raw }
    })
  }
  const choice = completion.choices?.[0]
  const content =
    typeof choice?.message?.content === 'string' ? stripThinkingBlocks(choice.message.content) : ''
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null
  return {
    content,
    finishReason,
    diagnostic: {
      request: diagnosticRequest,
      requestSent: true,
      response: { status: response.status, body: completion }
    } satisfies LlmProxyDiagnostic
  }
}
