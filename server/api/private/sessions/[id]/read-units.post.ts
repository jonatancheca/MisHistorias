import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import { markUnitsRead } from '../../../../utils/nsfwVn.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })
  const body = (await readBody(event)) as Record<string, unknown>
  const beatId = typeof body.beatId === 'string' ? body.beatId : ''
  const unitIndexes = Array.isArray(body.unitIndexes)
    ? body.unitIndexes.filter((item): item is number => Number.isInteger(item))
    : []
  if (!beatId) throw createError({ statusCode: 400, statusMessage: 'Falta beatId' })
  return { readUnits: markUnitsRead(id, user.id, beatId, unitIndexes) }
})
