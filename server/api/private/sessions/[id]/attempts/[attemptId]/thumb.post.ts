import { requireSessionUser } from '../../../../../../utils/nsfwAuth.ts'
import { setAttemptThumb } from '../../../../../../utils/nsfwProduct.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const attemptId = getRouterParam(event, 'attemptId')
  if (!attemptId) throw createError({ statusCode: 400, statusMessage: 'Falta attemptId' })
  const body = (await readBody(event)) as Record<string, unknown>
  const thumb = body.thumb === 'down' ? 'down' : body.thumb === 'up' ? 'up' : null
  if (!thumb) throw createError({ statusCode: 400, statusMessage: 'thumb inválido' })
  const attempt = setAttemptThumb(attemptId, user.id, thumb)
  return { attempt }
})
