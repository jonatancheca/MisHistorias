import { loadConfiguredModel, unloadAllModels, type LlmProxyError } from '../../utils/llm'
import { recordOperationalError } from '../../utils/errorTraces'
import { getStorage } from '../../utils/storage'

export default defineEventHandler(async (event) => {
  const session = await readAccessSession(event)
  if (session.multiUserEnabled && !session.isAdmin) {
    throw createError({ statusCode: 403, message: 'Operación reservada al administrador' })
  }

  const body = await readBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      (body.action !== 'load' && body.action !== 'unload-all') ||
      (body.scope !== 'normal' && body.scope !== 'private')) {
    throw createError({ statusCode: 400, message: 'Operación de modelos no válida' })
  }

  const settings = getStorage().readSettings()
  const usePrivate = body.scope === 'private' && settings?.value.privateLlmSettingsEnabled === true
  const proxySettings = {
    baseUrl: String(
      usePrivate
        ? (settings?.value.privateBaseUrl ?? settings?.value.baseUrl ?? 'http://localhost:1234')
        : (settings?.value.baseUrl ?? 'http://localhost:1234')
    ),
    apiKey: usePrivate ? settings?.privateApiKey ?? '' : settings?.apiKey ?? ''
  }

  try {
    if (body.action === 'load') {
      const model = String(
        usePrivate ? settings?.value.privateModel ?? settings?.value.model ?? '' : settings?.value.model ?? ''
      )
      return await loadConfiguredModel(proxySettings, model)
    }
    return await unloadAllModels(proxySettings)
  } catch (caught) {
    const error = caught as LlmProxyError
    if (error.status !== 400) {
      const diagnostic = error.diagnostic ?? {
        request: { method: 'POST', action: body.action },
        requestSent: false,
        response: null
      }
      recordOperationalError(event, {
        source: 'llm',
        operation: `llm.model-management.${body.action}`,
        message: error.message,
        scope: body.scope,
        status: error.status ?? null,
        requestSent: diagnostic.requestSent,
        request: diagnostic.request,
        response: diagnostic.response,
        stack: error.stack
      })
      event.context.errorTraceRecorded = true
    }
    throw createError({
      statusCode: error.status && error.status >= 400 ? error.status : 502,
      message: error.message
    })
  }
})
