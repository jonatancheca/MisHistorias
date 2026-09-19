import type { ErrorTraceSource } from '../../../shared/types/index.ts'
import { recordOperationalError } from '../../utils/errorTraces'

const CLIENT_SOURCES = new Set<ErrorTraceSource>(['llm', 'client'])

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, message: 'Traza no válida' })
  }
  const value = body as Record<string, unknown>
  if (
    typeof value.source !== 'string' ||
    !CLIENT_SOURCES.has(value.source as ErrorTraceSource) ||
    typeof value.operation !== 'string' ||
    !value.operation.trim() ||
    typeof value.message !== 'string' ||
    !value.message.trim()
  ) {
    throw createError({ statusCode: 400, message: 'Traza no válida' })
  }
  const trace = recordOperationalError(event, {
    source: value.source as ErrorTraceSource,
    operation: value.operation,
    message: value.message,
    scope: value.scope === 'normal' || value.scope === 'private' ? value.scope : null,
    status: typeof value.status === 'number' ? value.status : null,
    requestSent: typeof value.requestSent === 'boolean' ? value.requestSent : null,
    request: value.request,
    response: value.response,
    stack: typeof value.stack === 'string' ? value.stack : null
  })
  if (!trace) throw createError({ statusCode: 503, message: 'No se pudo guardar la traza' })
  return { id: trace.id }
})
