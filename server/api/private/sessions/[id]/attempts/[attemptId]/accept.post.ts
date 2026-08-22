import { requireSessionUser } from '../../../../../../utils/nsfwAuth.ts'
import { acceptAttempt, getAttempt, getStorySession } from '../../../../../../utils/nsfwStorage.ts'

export default defineEventHandler((event) => {
  const user = requireSessionUser(event)
  const sessionId = getRouterParam(event, 'id')
  const attemptId = getRouterParam(event, 'attemptId')
  if (!sessionId || !attemptId) {
    throw createError({ statusCode: 400, statusMessage: 'Faltan identificadores' })
  }
  const session = getStorySession(sessionId, user.id)
  const attempt = getAttempt(attemptId, user.id)
  if (!session || !attempt || attempt.sessionId !== sessionId) {
    throw createError({ statusCode: 404, statusMessage: 'Intento no encontrado' })
  }
  return acceptAttempt(session, attempt)
})
