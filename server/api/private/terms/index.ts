import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import { removeLabelFromAdultDefaults } from '../../../utils/nsfwProduct.ts'
import {
  createPrivateTerm,
  deletePrivateTerm,
  listInterestCatalog,
  listPrivateTerms
} from '../../../utils/nsfwStudio.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)

  if (event.method === 'GET') {
    return {
      catalog: listInterestCatalog(user.id),
      privateTerms: listPrivateTerms(user.id)
    }
  }

  if (event.method === 'POST') {
    const body = (await readBody(event)) as Record<string, unknown>
    const term = createPrivateTerm(user.id, {
      label: typeof body.label === 'string' ? body.label : '',
      kind: typeof body.kind === 'string' ? body.kind : 'interest'
    })
    return {
      term,
      catalog: listInterestCatalog(user.id),
      privateTerms: listPrivateTerms(user.id)
    }
  }

  if (event.method === 'DELETE') {
    const query = getQuery(event)
    let termId = typeof query.id === 'string' ? query.id : ''
    if (!termId) {
      const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
      termId = typeof body.id === 'string' ? body.id : ''
    }
    if (!termId) throw createError({ statusCode: 400, statusMessage: 'Falta id' })
    const removed = deletePrivateTerm(user.id, termId)
    removeLabelFromAdultDefaults(user.id, removed.label)
    return {
      ok: true,
      label: removed.label,
      catalog: listInterestCatalog(user.id),
      privateTerms: listPrivateTerms(user.id)
    }
  }

  throw createError({ statusCode: 405, statusMessage: 'Método no permitido' })
})
