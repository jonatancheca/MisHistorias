import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import { createCharacter, listCharacters } from '../../../../utils/nsfwStudio.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  if (event.method === 'GET') return { characters: listCharacters(user.id) }
  const body = (await readBody(event)) as Record<string, unknown>
  const character = createCharacter(user.id, {
    name: typeof body.name === 'string' ? body.name : '',
    tags: Array.isArray(body.tags) ? body.tags.filter((item): item is string => typeof item === 'string') : [],
    color: typeof body.color === 'string' ? body.color : undefined
  })
  return { character }
})
