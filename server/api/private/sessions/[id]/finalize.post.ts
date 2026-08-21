import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import { finalizeSession } from '../../../../utils/nsfwStorage.ts'

export default defineEventHandler((event) => {
  const user = requireSessionUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })
  return { session: finalizeSession(id, user.id) }
})
