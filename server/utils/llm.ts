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

export interface LmStudioModel {
  key: string
  type: 'llm' | 'embedding'
  loadedInstances: string[]
}

export interface LmStudioUnloadResult {
  total: number
  unloaded: number
  failed: Array<{ instanceId: string; message: string }>
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

async function fetchNativeModelJson(
  settings: LlmProxySettings,
  path: string,
  method: 'GET' | 'POST',
  body?: Record<string, string>
): Promise<unknown> {
  const url = `${normalizeLocalBaseUrl(settings.baseUrl)}/api/v1/models${path}`
  const headers = {
    accept: 'application/json',
    ...(body ? { 'content-type': 'application/json' } : {}),
    ...authHeader(settings.apiKey)
  }
  const diagnosticRequest = { url, method, headers, ...(body ? { body } : {}) }
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(path === '/load' ? 300_000 : 30_000)
    })
  } catch (caught) {
    throw connectionError(caught, diagnosticRequest)
  }
  const raw = await response.text().catch(() => '')
  if (response.status === 404 && !path) {
    throw llmError('LM Studio debe ser versión 0.4.0 o superior para gestionar modelos', 404)
  }
  if (!response.ok) throw responseError(response, raw, diagnosticRequest)
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw llmError('LM Studio devolvió una respuesta no válida', response.status, raw, {
      request: diagnosticRequest,
      requestSent: true,
      response: { status: response.status, body: raw }
    })
  }
}

export async function fetchNativeModels(settings: LlmProxySettings): Promise<LmStudioModel[]> {
  const payload = await fetchNativeModelJson(settings, '', 'GET')
  if (!payload || typeof payload !== 'object' || !('models' in payload) ||
      !Array.isArray(payload.models)) {
    throw llmError('LM Studio devolvió una lista de modelos no válida')
  }
  const models: LmStudioModel[] = []
  for (const item of payload.models) {
    if (!item || typeof item !== 'object' ||
        typeof item.key !== 'string' ||
        (item.type !== 'llm' && item.type !== 'embedding') ||
        !Array.isArray(item.loaded_instances) ||
        item.loaded_instances.some((instance: unknown) =>
          !instance || typeof instance !== 'object' || !('id' in instance) ||
          typeof instance.id !== 'string')) {
      throw llmError('LM Studio devolvió una lista de modelos no válida')
    }
    models.push({
      key: item.key,
      type: item.type,
      loadedInstances: item.loaded_instances.map((instance: { id: string }) => instance.id)
    })
  }
  return models
}

export async function loadConfiguredModel(settings: LlmProxySettings, model: string) {
  const key = model.trim()
  if (!key) throw llmError('Falta el modelo configurado', 400)
  const available = (await fetchNativeModels(settings)).find(item => item.key === key)
  if (!available) throw llmError('El modelo configurado no está disponible en LM Studio', 400)
  const loadedInstance = available.loadedInstances[0]
  if (loadedInstance) return { status: 'already-loaded' as const, instanceId: loadedInstance }
  const payload = await fetchNativeModelJson(settings, '/load', 'POST', { model: key })
  if (!payload || typeof payload !== 'object' ||
      !('instance_id' in payload) || typeof payload.instance_id !== 'string' ||
      !('status' in payload) || payload.status !== 'loaded') {
    throw llmError('LM Studio no confirmó la carga del modelo')
  }
  return { status: 'loaded' as const, instanceId: payload.instance_id }
}

export async function unloadAllModels(settings: LlmProxySettings): Promise<LmStudioUnloadResult> {
  const models = await fetchNativeModels(settings)
  const instanceIds = [...new Set(models.flatMap(model => model.loadedInstances))]
  const failed: LmStudioUnloadResult['failed'] = []
  for (const instanceId of instanceIds) {
    try {
      const payload = await fetchNativeModelJson(settings, '/unload', 'POST', {
        instance_id: instanceId
      })
      if (!payload || typeof payload !== 'object' ||
          !('instance_id' in payload) || payload.instance_id !== instanceId) {
        throw llmError('LM Studio no confirmó la descarga del modelo')
      }
    } catch (caught) {
      failed.push({
        instanceId,
        message: (caught as Error).message || 'No se pudo descargar'
      })
    }
  }
  return { total: instanceIds.length, unloaded: instanceIds.length - failed.length, failed }
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
