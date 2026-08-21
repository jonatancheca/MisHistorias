import { requireAdminUser } from '../../../../utils/nsfwAuth.ts'
import {
  listAllTaxonomy,
  listAdminComments,
  listAdminGenerations,
  listAdminPublications,
  listProductFeedback,
  setTaxonomyStatus,
  hideComment
} from '../../../../utils/nsfwProduct.ts'
import {
  adminWithdrawPublication,
  listDedupedPrivateTermsMissingPublic,
  promotePrivateLabelToPublic
} from '../../../../utils/nsfwStudio.ts'

export default defineEventHandler(async (event) => {
  requireAdminUser(event)
  const query = getQuery(event)
  const section = typeof query.section === 'string' ? query.section : 'overview'

  if (event.method === 'POST') {
    const body = (await readBody(event)) as Record<string, unknown>
    if (body.action === 'taxonomy') {
      const id = typeof body.termId === 'string' ? body.termId : ''
      const status = body.status
      if (status !== 'approved' && status !== 'discarded' && status !== 'proposed') {
        throw createError({ statusCode: 400, statusMessage: 'status inválido' })
      }
      return { term: setTaxonomyStatus(id, status) }
    }
    if (body.action === 'promote-private') {
      const label = typeof body.label === 'string' ? body.label : ''
      const kind = typeof body.kind === 'string' ? body.kind : 'interest'
      return promotePrivateLabelToPublic(label, kind)
    }
    if (body.action === 'hide-comment') {
      const id = typeof body.commentId === 'string' ? body.commentId : ''
      hideComment(id, body.hidden !== false)
      return { ok: true }
    }
    if (body.action === 'withdraw') {
      const id = typeof body.publicationId === 'string' ? body.publicationId : ''
      return { publication: adminWithdrawPublication(id) }
    }
    throw createError({ statusCode: 400, statusMessage: 'Acción desconocida' })
  }

  if (section === 'taxonomy') {
    return {
      taxonomy: listAllTaxonomy(),
      privateCandidates: listDedupedPrivateTermsMissingPublic()
    }
  }
  if (section === 'feedback') return { feedback: listProductFeedback() }
  if (section === 'generations') return { generations: listAdminGenerations() }
  if (section === 'publications') return { publications: listAdminPublications() }
  if (section === 'comments') return { comments: listAdminComments() }
  return {
    taxonomy: listAllTaxonomy(),
    privateCandidates: listDedupedPrivateTermsMissingPublic(),
    feedback: listProductFeedback(40),
    generations: listAdminGenerations(40),
    publications: listAdminPublications(),
    comments: listAdminComments(40)
  }
})
