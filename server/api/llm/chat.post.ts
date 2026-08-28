import { fetchProxyChat, type LlmMessageContent, type LlmProxyError } from '../../utils/llm'
import { getStorage } from '../../utils/storage'

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
  const usePrivate =
    value.scope === 'private' && settings?.value.privateLlmSettingsEnabled === true
  const abortController = new AbortController()
  const abort = () => abortController.abort()
  const abortIfResponseClosed = () => {
    if (!event.node.res.writableEnded) abort()
  }
  event.node.req.once('aborted', abort)
  event.node.res.once('close', abortIfResponseClosed)

  try {
    return await fetchProxyChat(
      {
        baseUrl: String(
          usePrivate
            ? (settings?.value.privateBaseUrl ?? settings?.value.baseUrl ?? 'http://localhost:1234')
            : (settings?.value.baseUrl ?? 'http://localhost:1234')
        ),
        apiKey: usePrivate ? settings?.privateApiKey ?? '' : settings?.apiKey ?? ''
      },
      {
        model: typeof value.model === 'string' ? value.model : '',
        messages,
        temperature: numberInRange(value.temperature, 0.8, 0, 2),
        maxTokens: numberInRange(value.maxTokens, 10000, 1, 100000),
        signal: abortController.signal
      }
    )
  } catch (caught) {
    if ((caught as Error)?.name === 'AbortError') throw caught
    const error = caught as LlmProxyError
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
