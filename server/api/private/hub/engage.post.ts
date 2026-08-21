import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import {
  addComment,
  getPublicationRatingSummary,
  listComments,
  ratePublication,
  sharePublicationPath
} from '../../../utils/nsfwStudio.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const body = (await readBody(event)) as Record<string, unknown>
  const publicationId = typeof body.publicationId === 'string' ? body.publicationId : ''
  if (!publicationId) throw createError({ statusCode: 400, statusMessage: 'Falta publicationId' })

  if (body.action === 'rate') {
    const score = Number(body.score)
    const rating = ratePublication(user.id, publicationId, score, {
      overall: score
    })
    return { rating, summary: getPublicationRatingSummary(publicationId) }
  }
  if (body.action === 'comment') {
    const comment = addComment(user.id, publicationId, typeof body.body === 'string' ? body.body : '')
    return { comment, comments: listComments(publicationId) }
  }
  if (body.action === 'share') {
    return sharePublicationPath(publicationId)
  }
  if (body.action === 'comments') {
    return { comments: listComments(publicationId), summary: getPublicationRatingSummary(publicationId) }
  }
  throw createError({ statusCode: 400, statusMessage: 'Acción desconocida' })
})
