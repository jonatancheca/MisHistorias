import { fetchSwarmCatalog, type SwarmProxyError } from '../../utils/swarm'
import { recordOperationalError } from '../../utils/errorTraces'
import { getStorage } from '../../utils/storage'

export default defineEventHandler(async (event) => {
  const settings = getStorage().readSettings()
  const abortController = new AbortController()
  const abort = () => abortController.abort()
  const abortIfResponseClosed = () => {
    if (!event.node.res.writableEnded) abort()
  }
  event.node.req.once('aborted', abort)
  event.node.res.once('close', abortIfResponseClosed)
  try {
    return await fetchSwarmCatalog(
      {
        baseUrl: String(settings?.value.swarmBaseUrl ?? ''),
        authToken: settings?.swarmAuthToken ?? ''
      },
      abortController.signal
    )
  } catch (caught) {
    if ((caught as Error)?.name === 'AbortError') throw caught
    const error = caught as SwarmProxyError
    recordOperationalError(event, {
      source: 'swarmui',
      operation: 'swarm.catalog',
      message: error.message,
      status: error.status ?? null,
      requestSent: error.diagnostic?.requestSent ?? null,
      request: {
        settings: {
          baseUrl: settings?.value.swarmBaseUrl ?? '',
          authToken: settings?.swarmAuthToken ?? ''
        },
        diagnostic: error.diagnostic?.request ?? null
      },
      response: error.diagnostic?.response ?? { detail: error.detail },
      stack: error.stack
    })
    event.context.errorTraceRecorded = true
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
