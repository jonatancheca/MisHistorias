import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import { syncBibleFact } from '../../../../utils/nsfwStorage.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })
  const body = (await readBody(event)) as Record<string, unknown>
  const session = syncBibleFact(id, user.id, {
    id: typeof body.id === 'string' ? body.id : undefined,
    entity: typeof body.entity === 'string' ? body.entity : '',
    text: typeof body.text === 'string' ? body.text : '',
    secret: Boolean(body.secret),
    knownByProtagonist: Boolean(body.knownByProtagonist)
  })
  return { session }
})
