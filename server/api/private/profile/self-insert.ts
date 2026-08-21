import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import {
  countUserRatings,
  getSelfInsertProfile,
  upsertSelfInsertProfile,
  type AdultDefaults
} from '../../../utils/nsfwProduct.ts'
import { MIN_TASTE_RATINGS } from '../../../../shared/lib/nsfwCreatorConfig.ts'

function asStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  if (event.method === 'GET') {
    return {
      profile: getSelfInsertProfile(user.id),
      ratingsCount: countUserRatings(user.id),
      tasteUnlocked: countUserRatings(user.id) >= MIN_TASTE_RATINGS,
      minTasteRatings: MIN_TASTE_RATINGS
    }
  }
  const body = (await readBody(event)) as Record<string, unknown>
  const adultRaw =
    body.adultDefaults && typeof body.adultDefaults === 'object'
      ? (body.adultDefaults as Record<string, unknown>)
      : null
  const adultDefaults: AdultDefaults | undefined = adultRaw
    ? {
        primary: asStringList(adultRaw.primary).slice(0, 5),
        excluded: asStringList(adultRaw.excluded),
        contextual: asStringList(adultRaw.contextual)
      }
    : undefined

  const profile = upsertSelfInsertProfile(user.id, {
    displayName: typeof body.displayName === 'string' ? body.displayName : 'Yo',
    pronouns: typeof body.pronouns === 'string' ? body.pronouns : '',
    appearance: typeof body.appearance === 'string' ? body.appearance : '',
    boundaries: asStringList(body.boundaries),
    adultDefaults
  })
  return { profile }
})
