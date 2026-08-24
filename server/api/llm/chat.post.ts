import { fetchProxyChat, type LlmProxyError } from '../../utils/llm'
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
  const messages = Array.isArray(value.messages)
    ? value.messages
        .filter(
          (message): message is { role: string; content: string } =>
            Boolean(message) &&
            typeof message === 'object' &&
            typeof (message as Record<string, unknown>).role === 'string' &&
            typeof (message as Record<string, unknown>).content === 'string'
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
