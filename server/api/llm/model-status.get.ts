import { getConfiguredModelStatus, type LlmProxyError } from '../../utils/llm'
import { recordOperationalError } from '../../utils/errorTraces'
import { getStorage } from '../../utils/storage'

export default defineEventHandler(async (event) => {
  const session = await readAccessSession(event)
  if (session.multiUserEnabled && !session.isAdmin) {
    throw createError({ statusCode: 403, message: 'Operación reservada al administrador' })
  }
  const scope = getQuery(event).scope === 'private' ? 'private' : 'normal'
  const settings = getStorage().readSettings()
  const usePrivate = scope === 'private' && settings?.value.privateLlmSettingsEnabled === true
  const proxySettings = {
    baseUrl: String(usePrivate
      ? settings?.value.privateBaseUrl ?? settings?.value.baseUrl ?? 'http://localhost:1234'
      : settings?.value.baseUrl ?? 'http://localhost:1234'),
    apiKey: usePrivate ? settings?.privateApiKey ?? '' : settings?.apiKey ?? ''
  }
  const model = String(usePrivate
    ? settings?.value.privateModel ?? settings?.value.model ?? ''
    : settings?.value.model ?? '')
  try {
    return await getConfiguredModelStatus(proxySettings, model)
  } catch (caught) {
    const error = caught as LlmProxyError
    if (error.status !== 400) {
      const diagnostic = error.diagnostic ?? {
        request: { method: 'GET', operation: 'model-status' }, requestSent: false, response: null
      }
      recordOperationalError(event, {
        source: 'llm', operation: 'llm.model-status', message: error.message, scope,
        status: error.status ?? null, requestSent: diagnostic.requestSent,
        request: diagnostic.request, response: diagnostic.response, stack: error.stack
      })
      event.context.errorTraceRecorded = true
    }
    throw createError({
      statusCode: error.status && error.status >= 400 ? error.status : 502,
      message: error.message
    })
  }
})
