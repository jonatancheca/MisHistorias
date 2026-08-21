import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import { getStorySession, updateStoryPlan } from '../../../../utils/nsfwStorage.ts'
import type { StoryPlanBeat } from '../../../../../shared/types/nsfw/session.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta id' })
  const session = getStorySession(id, user.id)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })

  const body = (await readBody(event)) as Record<string, unknown>
  const summary = typeof body.summary === 'string' ? body.summary : undefined
  let nextBeats: StoryPlanBeat[] | undefined
  if (Array.isArray(body.nextBeats)) {
    nextBeats = body.nextBeats.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const row = item as Record<string, unknown>
      const status = row.status
      if (status !== 'pending' && status !== 'done' && status !== 'skipped') return []
      return [
        {
          id: typeof row.id === 'string' ? row.id : `beat-${Date.now()}`,
          intent: typeof row.intent === 'string' ? row.intent : '',
          status
        }
      ]
    })
  }

  const updated = updateStoryPlan(id, user.id, { summary, nextBeats })
  return { session: updated }
})
