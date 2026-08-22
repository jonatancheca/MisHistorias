import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import { getStorySession } from '../../../../utils/nsfwStorage.ts'
import { createSceneCg, listSeenCgs, markCgSeen } from '../../../../utils/nsfwStudio.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const sessionId = getRouterParam(event, 'id')
  if (!sessionId) throw createError({ statusCode: 400, statusMessage: 'Falta id' })
  const session = getStorySession(sessionId, user.id)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })

  if (event.method === 'GET') {
    return {
      cgs: listSeenCgs(sessionId).map((row) => ({
        id: String(row.id),
        title: String(row.title),
        tags: (() => {
          try {
            return JSON.parse(String(row.tags_json || '[]'))
          } catch {
            return []
          }
        })(),
        seenAt: Number(row.seen_at)
      }))
    }
  }

  const body = (await readBody(event)) as Record<string, unknown>
  const title = typeof body.title === 'string' ? body.title : 'CG'
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((item): item is string => typeof item === 'string')
    : []
  const cg = createSceneCg(user.id, { title, tags })
  markCgSeen(sessionId, cg.id)
  return { cg, cgs: listSeenCgs(sessionId) }
})
