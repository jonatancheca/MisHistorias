import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import { getSpriteMedia } from '../../../../utils/nsfwStudio.ts'

export default defineEventHandler((event) => {
  const user = requireSessionUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta id' })
  const media = getSpriteMedia(id, user.id)
  if (!media) throw createError({ statusCode: 404, statusMessage: 'Sprite no encontrado' })
  setHeader(event, 'Content-Type', media.mimeType)
  setHeader(event, 'Cache-Control', 'private, max-age=60')
  return media.data
})
