import { requireSessionUser } from '../../../../../../utils/nsfwAuth.ts'
import { selectSiblingAttempt } from '../../../../../../utils/nsfwStorage.ts'

export default defineEventHandler((event) => {
  const user = requireSessionUser(event)
  const attemptId = getRouterParam(event, 'attemptId')
  if (!attemptId) throw createError({ statusCode: 400, statusMessage: 'Falta el intento' })
  return selectSiblingAttempt(user.id, attemptId)
})
