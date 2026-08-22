import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import { listVnSaves, listReadUnits } from '../../../../utils/nsfwVn.ts'

export default defineEventHandler((event) => {
  const user = requireSessionUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })
  return {
    saves: listVnSaves(id, user.id),
    readUnits: listReadUnits(id)
  }
})
