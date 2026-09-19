import { fetchProxyModels, type LlmProxyError } from '../../utils/llm'
import { recordOperationalError } from '../../utils/errorTraces'
import { getStorage } from '../../utils/storage'

export default defineEventHandler(async (event) => {
  const settings = getStorage().readSettings()
  const scope = getQuery(event).scope === 'private' ? 'private' : 'normal'
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
  try {
    return await fetchProxyModels(proxySettings)
  } catch (caught) {
    const error = caught as LlmProxyError
    if ((error as Error).name === 'AbortError') throw caught
    const diagnostic = error.diagnostic ?? {
      request: { settings: proxySettings, method: 'GET' },
      requestSent: false,
      response: null
    }
    recordOperationalError(event, {
      source: 'llm',
      operation: 'llm.models',
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
  }
})
