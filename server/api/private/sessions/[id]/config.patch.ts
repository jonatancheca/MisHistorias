import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import { updateStorySessionConfig } from '../../../../utils/nsfwStorage.ts'
import type {
  GenerationProfile,
  InteractionPolicy
} from '../../../../../shared/types/nsfw/session.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta id' })
  if (event.method !== 'PATCH') {
    throw createError({ statusCode: 405, statusMessage: 'Método no permitido' })
  }

  const body = (await readBody(event)) as Record<string, unknown>
  const asString = (value: unknown) => (typeof value === 'string' ? value : undefined)
  const asList = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : undefined

  const interactionPolicy = asString(body.interactionPolicy) as InteractionPolicy | undefined
  const generationProfile = asString(body.generationProfile) as GenerationProfile | undefined

  const session = updateStorySessionConfig(id, user.id, {
    title: asString(body.title),
    premise: asString(body.premise),
    duration: asString(body.duration),
    tone: asString(body.tone),
    perspective: asString(body.perspective),
    interactionPolicy,
    generationProfile,
    modelAlias: asString(body.modelAlias),
    interests: asList(body.interests),
    exclusions: asList(body.exclusions)
  })

  return { session }
})
