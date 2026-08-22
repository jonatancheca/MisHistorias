import { requireSessionUser } from '../../../../../../utils/nsfwAuth.ts'
import { discardAttempt, getAttempt } from '../../../../../../utils/nsfwStorage.ts'

export default defineEventHandler((event) => {
  const user = requireSessionUser(event)
  const attemptId = getRouterParam(event, 'attemptId')
  if (!attemptId) throw createError({ statusCode: 400, statusMessage: 'Falta el intento' })
  const attempt = getAttempt(attemptId, user.id)
  if (!attempt) throw createError({ statusCode: 404, statusMessage: 'Intento no encontrado' })
  return { attempt: discardAttempt(attemptId) }
})
