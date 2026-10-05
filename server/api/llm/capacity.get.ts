import { ContextMeasurementError, measureLmStudioContext } from '../../utils/contextTokens'
import { getStorage } from '../../utils/storage'

export default defineEventHandler(async (event) => {
  const settings = getStorage().readSettings()
  const usePrivate = getQuery(event).scope === 'private' && settings?.value.privateLlmSettingsEnabled === true
  const model = String(usePrivate ? settings?.value.privateModel ?? settings?.value.model ?? '' : settings?.value.model ?? '')
  if (!model.trim()) throw createError({ statusCode: 400, message: 'Configura primero el modelo en Ajustes.' })
  const controller = new AbortController()
  const abort = () => controller.abort()
  const closed = () => { if (!event.node.res.writableEnded) abort() }
  event.node.req.once('aborted', abort)
  event.node.res.once('close', closed)
  try {
    const result = await measureLmStudioContext({
      baseUrl: String(usePrivate ? settings?.value.privateBaseUrl ?? settings?.value.baseUrl ?? 'http://localhost:1234'
        : settings?.value.baseUrl ?? 'http://localhost:1234'),
      apiKey: usePrivate ? settings?.privateApiKey ?? '' : settings?.apiKey ?? ''
    }, model, undefined, controller.signal)
    return { capacity: result.capacity, model: result.model }
  } catch (caught) {
    if ((caught as Error).name === 'AbortError') throw caught
    const failure = caught instanceof ContextMeasurementError ? caught : new ContextMeasurementError('connection')
    throw createError({ statusCode: failure.code === 'model_not_loaded' ? 409 : 502, message: failure.message, data: { code: failure.code, message: failure.message } })
  } finally {
    event.node.req.off('aborted', abort)
    event.node.res.off('close', closed)
  }
})
