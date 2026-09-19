import { reportClientErrorTrace } from '~/lib/errorTraces'

function errorDetails(value: unknown) {
  if (value instanceof Error) {
    return { message: value.message || value.name, stack: value.stack ?? null, response: value }
  }
  return { message: String(value), stack: null, response: value }
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('vue:error', (value, _instance, info) => {
    const error = errorDetails(value)
    void reportClientErrorTrace({
      source: 'client',
      operation: 'vue.error',
      message: error.message,
      requestSent: null,
      request: { location: window.location.href, info },
      response: error.response,
      stack: error.stack
    })
  })

  window.addEventListener('error', (event) => {
    const error = errorDetails(event.error ?? event.message)
    void reportClientErrorTrace({
      source: 'client',
      operation: 'window.error',
      message: error.message,
      requestSent: null,
      request: {
        location: window.location.href,
        filename: event.filename,
        line: event.lineno,
        column: event.colno
      },
      response: error.response,
      stack: error.stack
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const error = errorDetails(event.reason)
    void reportClientErrorTrace({
      source: 'client',
      operation: 'window.unhandledrejection',
      message: error.message,
      requestSent: null,
      request: { location: window.location.href },
      response: error.response,
      stack: error.stack
    })
  })
})
