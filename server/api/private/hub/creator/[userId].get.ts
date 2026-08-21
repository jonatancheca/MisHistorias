import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import { getCreatorPublicProfile } from '../../../../utils/nsfwStudio.ts'

export default defineEventHandler((event) => {
  requireSessionUser(event)
  const userId = getRouterParam(event, 'userId')
  if (!userId) throw createError({ statusCode: 400, statusMessage: 'Falta userId' })
  const profile = getCreatorPublicProfile(userId)
  if (!profile) throw createError({ statusCode: 404, statusMessage: 'Creador no encontrado' })
  return { profile }
})
