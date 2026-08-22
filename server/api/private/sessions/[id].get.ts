import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import { getPlayState } from '../../../utils/nsfwStorage.ts'

export default defineEventHandler((event) => {
  const user = requireSessionUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })
  const state = getPlayState(id, user.id)
  if (!state) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })
  return state
})
