import { requireSessionUser } from '../../../../../utils/nsfwAuth.ts'
import { getStorySession, updateCastMember } from '../../../../../utils/nsfwStorage.ts'
import { cloneCharacterFromCast } from '../../../../../utils/nsfwStudio.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const sessionId = getRouterParam(event, 'id')
  const actorId = getRouterParam(event, 'actorId')
  if (!sessionId || !actorId) throw createError({ statusCode: 400, statusMessage: 'Faltan ids' })

  const session = getStorySession(sessionId, user.id)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })
  const member = session.cast.find((item) => item.actorId === actorId)
  if (!member) throw createError({ statusCode: 404, statusMessage: 'Actor no encontrado' })

  const body = (await readBody(event)) as Record<string, unknown>

  if (body.action === 'clone') {
    const character = cloneCharacterFromCast(user.id, {
      name: typeof body.name === 'string' ? body.name : member.name,
      personality: member.personality,
      characterization: member.characterization,
      sourceCharacterId: member.sourceCharacterId
    })
    return { character }
  }

  const updated = updateCastMember(sessionId, user.id, actorId, {
    name: typeof body.name === 'string' ? body.name : member.name,
    personality: typeof body.personality === 'string' ? body.personality : member.personality,
    characterization:
      typeof body.characterization === 'string' ? body.characterization : member.characterization,
    overrideName: typeof body.overrideName === 'string' ? body.overrideName : member.overrideName,
    preservedRelations: Array.isArray(body.preservedRelations)
      ? body.preservedRelations.filter((item): item is string => typeof item === 'string')
      : member.preservedRelations
  })
  return { session: updated }
})
