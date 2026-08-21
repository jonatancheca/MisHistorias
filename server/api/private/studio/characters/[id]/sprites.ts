import { requireSessionUser } from '../../../../../utils/nsfwAuth.ts'
import { addSprite, getSprites } from '../../../../../utils/nsfwStudio.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const characterId = getRouterParam(event, 'id')
  if (!characterId) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })
  if (event.method === 'GET') return { sprites: getSprites(characterId, user.id) }
  const body = (await readBody(event)) as Record<string, unknown>
  const sprite = addSprite(user.id, {
    characterId,
    label: typeof body.label === 'string' ? body.label : 'Sprite',
    facets: Array.isArray(body.facets)
      ? body.facets.filter((item): item is string => typeof item === 'string')
      : [],
    mimeType: typeof body.mimeType === 'string' ? body.mimeType : undefined,
    dataBase64: typeof body.dataBase64 === 'string' ? body.dataBase64 : undefined
  })
  return { sprite }
})
