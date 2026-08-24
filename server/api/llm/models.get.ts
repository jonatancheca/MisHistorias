import { fetchProxyModels, type LlmProxyError } from '../../utils/llm'
import { getStorage } from '../../utils/storage'

export default defineEventHandler(async () => {
  const settings = getStorage().readSettings()
  try {
    return await fetchProxyModels({
      baseUrl: String(settings?.value.baseUrl ?? 'http://localhost:1234'),
      apiKey: settings?.apiKey ?? ''
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
