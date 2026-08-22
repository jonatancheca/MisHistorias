import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import { forkFromBeat } from '../../../../utils/nsfwStorage.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const beatId = getRouterParam(event, 'beatId')
  if (!beatId) throw createError({ statusCode: 400, statusMessage: 'Falta el beat' })
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const branchLabel = typeof body.branchLabel === 'string' ? body.branchLabel : undefined
  const session = forkFromBeat(user.id, beatId, branchLabel)
  return { session }
})
