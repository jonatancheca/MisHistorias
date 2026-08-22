import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import { setEscalationHeart } from '../../../../utils/nsfwStorage.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta id' })
  const body = (await readBody(event)) as Record<string, unknown>
  const session = setEscalationHeart(id, user.id, body.value !== false)
  return { session }
})
