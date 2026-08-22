import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import { createPlace, listPlaces } from '../../../../utils/nsfwStudio.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  if (event.method === 'GET') return { places: listPlaces(user.id) }
  const body = (await readBody(event)) as Record<string, unknown>
  const place = createPlace(user.id, {
    name: typeof body.name === 'string' ? body.name : '',
    setting: typeof body.setting === 'string' ? body.setting : undefined,
    era: typeof body.era === 'string' ? body.era : undefined,
    tags: Array.isArray(body.tags) ? body.tags.filter((item): item is string => typeof item === 'string') : []
  })
  return { place }
})
