import type { ErrorTraceSource } from '../../../shared/types/index.ts'
import { requireAccessAdmin } from '../../utils/access'
import {
  readConfiguredOperationalSecrets,
  sanitizeOperationalErrorTrace
} from '../../utils/errorTraces'
import { getStorage, type DataScope } from '../../utils/storage'

const SOURCES = new Set<ErrorTraceSource>([
  'llm', 'swarmui', 'backup', 'update', 'sqlite', 'server', 'client'
])

export default defineEventHandler(async (event) => {
  await requireAccessAdmin(event)
  const query = getQuery(event)
  const source = typeof query.source === 'string' && SOURCES.has(query.source as ErrorTraceSource)
    ? query.source as ErrorTraceSource
    : undefined
  const scope = query.scope === 'normal' || query.scope === 'private'
    ? query.scope as DataScope
    : undefined
  const result = getStorage().listErrorTraces({
    source,
    scope,
    owner: typeof query.owner === 'string' ? query.owner : undefined,
    limit: Number(query.limit),
    offset: Number(query.offset)
  })
  const secrets = readConfiguredOperationalSecrets()
  return {
    ...result,
    items: result.items.map(trace => sanitizeOperationalErrorTrace(trace, secrets))
  }
})
