import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import {
  getSelfInsertProfile,
  upsertSelfInsertProfile
} from '../../../utils/nsfwProduct.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  if (event.method === 'GET') {
    return { profile: getSelfInsertProfile(user.id) }
  }
  const body = (await readBody(event)) as Record<string, unknown>
  const profile = upsertSelfInsertProfile(user.id, {
    displayName: typeof body.displayName === 'string' ? body.displayName : 'Yo',
    pronouns: typeof body.pronouns === 'string' ? body.pronouns : '',
    appearance: typeof body.appearance === 'string' ? body.appearance : '',
    boundaries: Array.isArray(body.boundaries)
      ? body.boundaries.filter((item): item is string => typeof item === 'string')
      : []
  })
  return { profile }
})
