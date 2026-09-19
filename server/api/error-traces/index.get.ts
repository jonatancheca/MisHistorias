import type { ErrorTraceSource } from '../../../shared/types/index.ts'
import { requireAccessAdmin } from '../../utils/access'
import { getStorage, type DataScope } from '../../utils/storage'

const SOURCES = new Set<ErrorTraceSource>([
  'llm', 'swarmui', 'backup', 'update', 'sqlite', 'server', 'client'
])

export default defineEventHandler((event) => {
  requireAccessAdmin(event)
  const query = getQuery(event)
  const source = typeof query.source === 'string' && SOURCES.has(query.source as ErrorTraceSource)
    ? query.source as ErrorTraceSource
    : undefined
  const scope = query.scope === 'normal' || query.scope === 'private'
    ? query.scope as DataScope
    : undefined
  return getStorage().listErrorTraces({
    source,
    scope,
    owner: typeof query.owner === 'string' ? query.owner : undefined,
    limit: Number(query.limit),
    offset: Number(query.offset)
  })
})
