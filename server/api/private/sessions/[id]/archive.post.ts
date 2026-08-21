import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import { setSessionArchived } from '../../../../utils/nsfwStorage.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })
  const body = (await readBody(event)) as Record<string, unknown>
  const archived = Boolean(body.archived)
  return { session: setSessionArchived(id, user.id, archived) }
})
