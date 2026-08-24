import { fetchProxyModels, type LlmProxyError } from '../../utils/llm'
import { getStorage } from '../../utils/storage'

export default defineEventHandler(async (event) => {
  const settings = getStorage().readSettings()
  const usePrivate =
    getQuery(event).scope === 'private' && settings?.value.privateLlmSettingsEnabled === true
  try {
    return await fetchProxyModels({
      baseUrl: String(
        usePrivate
          ? (settings?.value.privateBaseUrl ?? settings?.value.baseUrl ?? 'http://localhost:1234')
          : (settings?.value.baseUrl ?? 'http://localhost:1234')
      ),
      apiKey: usePrivate ? settings?.privateApiKey ?? '' : settings?.apiKey ?? ''
    })
  } catch (caught) {
    const error = caught as LlmProxyError
    throw createError({
      statusCode: error.status && error.status >= 400 ? error.status : 502,
      message: error.message,
      data: { detail: error.detail }
    })
  }
})
