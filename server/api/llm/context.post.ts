import { measureLmStudioContext } from '../../utils/contextTokens'
import { getStorage } from '../../utils/storage'
import { recordOperationalError } from '../../utils/errorTraces'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (!body || typeof body.model !== 'string' || !body.model.trim() || !Array.isArray(body.messages) ||
      !body.messages.length || !body.messages.every((message: { role?: unknown; content?: unknown }) =>
        message && ['system', 'user', 'assistant'].includes(String(message.role)) && typeof message.content === 'string')) {
    throw createError({ statusCode: 400, message: 'Contexto no válido' })
  }
  const scope = body.scope === 'private' ? 'private' : 'normal'
  const settings = getStorage().readSettings()
  const usePrivate = scope === 'private' && settings?.value.privateLlmSettingsEnabled === true
  const proxySettings = {
    baseUrl: String(usePrivate ? settings?.value.privateBaseUrl ?? settings?.value.baseUrl ?? 'http://localhost:1234'
      : settings?.value.baseUrl ?? 'http://localhost:1234'),
    apiKey: usePrivate ? settings?.privateApiKey ?? '' : settings?.apiKey ?? ''
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  const closed = () => { if (!event.node.res.writableEnded) abort() }
  event.node.req.once('aborted', abort)
  event.node.res.once('close', closed)
  try {
    return await measureLmStudioContext(proxySettings, body.model, body.messages, controller.signal)
  } catch (caught) {
    if ((caught as Error).name === 'AbortError') throw caught
    const message = 'No se pudieron medir los tokens con LM Studio. Comprueba la conexión, el token y que el modelo configurado esté cargado y permita usar su tokenizer.'
    recordOperationalError(event, {
      source: 'llm', operation: 'story.context', message, scope, requestSent: null,
      request: { model: body.model, messages: body.messages }, response: null
    })
    event.context.errorTraceRecorded = true
    throw createError({ statusCode: 502, message })
  } finally {
    event.node.req.off('aborted', abort)
    event.node.res.off('close', closed)
  }
})
