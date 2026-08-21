import { requireSessionUser } from '../../../../../../utils/nsfwAuth.ts'
import { retryAttempt } from '../../../../../../services/nsfw/generationOrchestrator.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const attemptId = getRouterParam(event, 'attemptId')
  if (!attemptId) throw createError({ statusCode: 400, statusMessage: 'Falta el intento' })
  const attempt = await retryAttempt(attemptId, user.id)
  return { attempt }
})
