import { fetchProxyChat, type LlmMessageContent, type LlmProxyError } from '../../utils/llm'
import { recordOperationalError } from '../../utils/errorTraces'
import { getStorage } from '../../utils/storage'
import { ContextMeasurementError, measureLmStudioContext } from '../../utils/contextTokens'
import { resolveAutoResponseTokens } from '../../../shared/utils/tokenLimits'

function numberInRange(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, message: 'Petición no válida' })
  }
  const value = body as Record<string, unknown>
  const isContent = (content: unknown): content is LlmMessageContent => {
    if (typeof content === 'string') return true
    if (!Array.isArray(content) || content.length === 0 || content.length > 4) return false
    return content.every((part) => {
      if (!part || typeof part !== 'object' || typeof (part as Record<string, unknown>).type !== 'string') {
        return false
      }
      const item = part as Record<string, unknown>
      if (item.type === 'text') return typeof item.text === 'string' && item.text.length <= 100_000
      if (item.type !== 'image_url' || !item.image_url || typeof item.image_url !== 'object') return false
      const url = (item.image_url as Record<string, unknown>).url
      return typeof url === 'string' && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(url) && url.length <= 20_000_000
    })
  }
  const messages = Array.isArray(value.messages)
    ? value.messages
        .filter(
          (message): message is { role: string; content: LlmMessageContent } =>
            Boolean(message) &&
            typeof message === 'object' &&
            typeof (message as Record<string, unknown>).role === 'string' &&
            isContent((message as Record<string, unknown>).content)
        )
        .map((message) => ({ role: message.role, content: message.content }))
    : []
  const settings = getStorage().readSettings()
  const scope = value.scope === 'private' ? 'private' : 'normal'
  const usePrivate =
    scope === 'private' && settings?.value.privateLlmSettingsEnabled === true
  const proxySettings = {
    baseUrl: String(
      usePrivate
        ? (settings?.value.privateBaseUrl ?? settings?.value.baseUrl ?? 'http://localhost:1234')
        : (settings?.value.baseUrl ?? 'http://localhost:1234')
    ),
    apiKey: usePrivate ? settings?.privateApiKey ?? '' : settings?.apiKey ?? ''
  }
  if (value.maxTokens === 'auto') {
    if (!messages.length || messages.some(message => !['system', 'user', 'assistant'].includes(message.role))) {
      throw createError({ statusCode: 400, message: 'Contexto no válido para calcular la respuesta automática.' })
    }
    if (messages.some(message => typeof message.content !== 'string')) {
      throw createError({ statusCode: 422, message: 'Auto no puede medir los tokens de las imágenes. Elige un máximo de tokens de respuesta manual para esta petición.' })
    }
  }
  const proxyRequest = {
    model: typeof value.model === 'string' ? value.model : '',
    messages,
    temperature: numberInRange(value.temperature, 0.8, 0, 2),
    maxTokens: numberInRange(value.maxTokens, 10000, 1, 100000)
  }
  const operation = typeof value.operation === 'string' && value.operation.trim()
    ? value.operation.slice(0, 200)
    : 'llm.chat'
  const abortController = new AbortController()
  const abort = () => abortController.abort()
  const abortIfResponseClosed = () => {
    if (!event.node.res.writableEnded) abort()
  }
  event.node.req.once('aborted', abort)
  event.node.res.once('close', abortIfResponseClosed)

  try {
    if (value.maxTokens === 'auto') {
      const measured = await measureLmStudioContext(proxySettings, proxyRequest.model,
        messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, abortController.signal)
      proxyRequest.maxTokens = resolveAutoResponseTokens(measured.tokens, measured.capacity)
      proxyRequest.model = measured.model
    }
    const result = await fetchProxyChat(proxySettings, {
      ...proxyRequest,
      signal: abortController.signal
    })
    if (!result.content.trim() || result.finishReason === 'length') {
      recordOperationalError(event, {
        source: 'llm',
        operation,
        message: result.finishReason === 'length'
          ? 'La respuesta del modelo quedó truncada.'
          : 'El modelo no devolvió contenido visible.',
        scope,
        status: result.diagnostic.response?.status ?? 200,
        requestSent: result.diagnostic.requestSent,
        request: result.diagnostic.request,
        response: result.diagnostic.response
      })
      event.context.errorTraceRecorded = true
    }
    return { content: result.content, finishReason: result.finishReason, maxTokens: proxyRequest.maxTokens }
  } catch (caught) {
    if ((caught as Error)?.name === 'AbortError') throw caught
    if (caught instanceof ContextMeasurementError && caught.code === 'model_not_loaded') {
      throw createError({ statusCode: 409, message: caught.message, data: { code: caught.code } })
    }
    const error = caught as LlmProxyError
    if (caught instanceof ContextMeasurementError) error.status = 502
    const diagnostic = error.diagnostic ?? {
      request: { settings: proxySettings, body: proxyRequest },
      requestSent: false,
      response: null
    }
    recordOperationalError(event, {
      source: 'llm',
      operation,
      message: error.message,
      scope,
      status: error.status ?? null,
      requestSent: diagnostic.requestSent,
      request: diagnostic.request,
      response: diagnostic.response,
      stack: error.stack
    })
    event.context.errorTraceRecorded = true
    throw createError({
      statusCode: error.status && error.status >= 400 ? error.status : 502,
      message: error.message,
      data: { detail: error.detail }
    })
  } finally {
    event.node.req.off('aborted', abort)
    event.node.res.off('close', abortIfResponseClosed)
  }
})
