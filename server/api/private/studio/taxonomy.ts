import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import { listTaxonomy, proposeTaxonomyTerm } from '../../../utils/nsfwStudio.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  if (event.method === 'GET') {
    const query = getQuery(event)
    const status =
      query.status === 'proposed' || query.status === 'discarded' || query.status === 'approved'
        ? query.status
        : 'approved'
    return { terms: listTaxonomy(status) }
  }
  const body = (await readBody(event)) as Record<string, unknown>
  const term = proposeTaxonomyTerm(user.id, {
    label: typeof body.label === 'string' ? body.label : '',
    kind: typeof body.kind === 'string' ? body.kind : undefined
  })
  return { term }
})
