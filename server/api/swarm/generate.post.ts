import { generateSwarmImage, type SwarmProxyError } from '../../utils/swarm'
import { getStorage } from '../../utils/storage'

export default defineEventHandler(async (event) => {
  const rawBody = await readBody(event)
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    throw createError({ statusCode: 400, message: 'Petición no válida' })
  }
  const body = rawBody as Record<string, unknown>
  const prompt = typeof body.prompt === 'string' ? body.prompt : ''
  const preset = typeof body.preset === 'string' ? body.preset : ''
  const model = typeof body.model === 'string' ? body.model : ''
  const lora = typeof body.lora === 'string' ? body.lora : ''
  if (!prompt.trim() || prompt.length > 100_000 || (!preset.trim() && !model.trim())) {
    throw createError({
      statusCode: 400,
      message: 'Indica un prompt y un preset o modelo'
    })
  }

  const settings = getStorage().readSettings()
  const abortController = new AbortController()
  const abort = () => abortController.abort()
  const abortIfResponseClosed = () => {
    if (!event.node.res.writableEnded) abort()
  }
  event.node.req.once('aborted', abort)
  event.node.res.once('close', abortIfResponseClosed)
  try {
    const image = await generateSwarmImage(
      {
        baseUrl: String(settings?.value.swarmBaseUrl ?? 'http://localhost:7801'),
        authToken: settings?.swarmAuthToken ?? ''
      },
      {
        prompt,
        ...(preset.trim() ? { preset } : {}),
        ...(model.trim() ? { model } : {}),
        ...(lora.trim() ? { lora } : {}),
        signal: abortController.signal
      }
    )
    setResponseHeader(event, 'content-type', image.mimeType)
    setResponseHeader(event, 'content-length', String(image.bytes.byteLength))
    setResponseHeader(event, 'cache-control', 'no-store, max-age=0')
    return image.bytes
  } catch (caught) {
    if ((caught as Error)?.name === 'AbortError') throw caught
    const error = caught as SwarmProxyError
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
