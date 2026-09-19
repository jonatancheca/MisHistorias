import { getRequestHeaders, getRequestURL } from 'h3'
import { recordOperationalError } from '../utils/errorTraces'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, context) => {
    const event = context.event
    if ((error as { name?: string }).name === 'AbortError') return
    const status = Number((error as { statusCode?: number }).statusCode || 500)
    if (status < 500) return
    if (event?.context.errorTraceRecorded) return
    const path = event ? getRequestURL(event).pathname : ''
    if (path.startsWith('/api/error-traces')) return
    recordOperationalError(event, {
      source: 'server',
      operation: event ? `${event.method} ${path}` : 'server.unhandled',
      message: error.message || 'Error inesperado del servidor',
      status,
      requestSent: false,
      request: event ? {
        url: getRequestURL(event).toString(),
        headers: getRequestHeaders(event)
      } : null,
      response: error,
      stack: error.stack
    })
    if (event) event.context.errorTraceRecorded = true
  })
})
