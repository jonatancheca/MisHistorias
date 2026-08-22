import { requireSessionUser } from '../../../../../utils/nsfwAuth.ts'
import { setPlaceBackground } from '../../../../../utils/nsfwStudio.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const placeId = getRouterParam(event, 'id')
  if (!placeId) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })
  const body = (await readBody(event)) as Record<string, unknown>
  if (typeof body.dataBase64 !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Falta dataBase64' })
  }
  const background = setPlaceBackground(user.id, placeId, {
    dataBase64: body.dataBase64,
    mimeType: typeof body.mimeType === 'string' ? body.mimeType : undefined
  })
  return { background }
})
