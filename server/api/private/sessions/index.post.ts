import { randomUUID } from 'node:crypto'
import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import { createStorySession } from '../../../utils/nsfwStorage.ts'
import { buildDefaultAssetPins, listExperiences } from '../../../utils/nsfwStudio.ts'
import type {
  CreateStorySessionInput,
  InteractionPolicy,
  GenerationProfile,
  NsfwStoryFormat,
  SessionAssetPins,
  SessionCastMember
} from '../../../../shared/types/nsfw/session.ts'

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const body = (await readBody(event)) as Record<string, unknown>
  const format = asString(body.format, 'story') as NsfwStoryFormat
  if (format !== 'story' && format !== 'chat' && format !== 'vn') {
    throw createError({ statusCode: 400, statusMessage: 'Formato no válido' })
  }

  const castRaw = Array.isArray(body.cast) ? body.cast : []
  const cast: SessionCastMember[] = castRaw.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const role = asString(row.role, 'character')
    if (role !== 'protagonist' && role !== 'character' && role !== 'narrator') return []
    return [
      {
        actorId: asString(row.actorId) || randomUUID(),
        name: asString(row.name, 'Personaje'),
        role,
        personality: asString(row.personality),
        isSelfInsert: Boolean(row.isSelfInsert)
      }
    ]
  })

  const experienceId = asString(body.experienceId) || null
  let assetPins: SessionAssetPins | undefined
  if (body.assetPins && typeof body.assetPins === 'object') {
    const pins = body.assetPins as Record<string, unknown>
    assetPins = {
      placeId: typeof pins.placeId === 'string' ? pins.placeId : null,
      placeBackgroundId: typeof pins.placeBackgroundId === 'string' ? pins.placeBackgroundId : null,
      characterSprites:
        pins.characterSprites && typeof pins.characterSprites === 'object'
          ? Object.fromEntries(
              Object.entries(pins.characterSprites as Record<string, unknown>).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string'
              )
            )
          : {}
    }
  } else if (format === 'vn' || format === 'chat') {
    assetPins = buildDefaultAssetPins(user.id)
  }

  if (experienceId) {
    const experience = listExperiences(user.id).find((item) => item.id === experienceId)
    if (!experience) throw createError({ statusCode: 404, statusMessage: 'Experience no encontrada' })
  }

  const input: CreateStorySessionInput = {
    title: asString(body.title, 'Historia'),
    premise: asString(body.premise),
    format,
    duration: asString(body.duration, 'medium'),
    tone: asString(body.tone, 'sensual'),
    perspective: asString(body.perspective, 'second'),
    interactionPolicy: (asString(body.interactionPolicy, 'pause') as InteractionPolicy) || 'pause',
    generationProfile: (asString(body.generationProfile, 'quick') as GenerationProfile) || 'quick',
    modelAlias: asString(body.modelAlias),
    cast,
    interests: asStringArray(body.interests).slice(0, 5),
    exclusions: asStringArray(body.exclusions),
    planSummary: asString(body.planSummary),
    experienceId,
    assetPins
  }

  if (!input.premise.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Falta la premisa' })
  }
  if (!input.modelAlias.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Falta el modelo' })
  }

  const session = createStorySession(user.id, input)
  return { session }
})
