import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import {
  createAttempt,
  getStorySession,
  prepareRerollSource
} from '../../../../utils/nsfwStorage.ts'
import { resolveModelByAlias } from '../../../../services/nsfw/modelCatalog.ts'
import { getStorage } from '../../../../utils/storage.ts'
import { runGenerationFromPrepared } from '../../../../services/nsfw/generationOrchestrator.ts'
import type { GenerationProfile } from '../../../../../shared/types/nsfw/session.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const sessionId = getRouterParam(event, 'id')
  if (!sessionId) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })
  const body = (await readBody(event)) as Record<string, unknown>
  const attemptId = typeof body.attemptId === 'string' ? body.attemptId : ''
  if (!attemptId) throw createError({ statusCode: 400, statusMessage: 'Falta attemptId' })

  const session = getStorySession(sessionId, user.id)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })

  const source = prepareRerollSource(user.id, attemptId)
  if (source.sessionId !== sessionId) {
    throw createError({ statusCode: 404, statusMessage: 'Intento no encontrado' })
  }

  const modelAlias =
    typeof body.modelAlias === 'string' && body.modelAlias.trim()
      ? body.modelAlias
      : source.modelAlias
  const generationProfile = (
    typeof body.generationProfile === 'string' ? body.generationProfile : source.generationProfile
  ) as GenerationProfile

  const model = resolveModelByAlias(modelAlias)
  if (!model) throw createError({ statusCode: 400, statusMessage: 'Modelo no configurado' })
  const settings = getStorage().readSettings()
  const mockMode = Boolean(settings?.value.mockMode)
  const modelId = mockMode ? `mock:${model.lmStudioModelId}` : model.lmStudioModelId

  const attempt = createAttempt({
    session,
    input: source.input,
    modelAlias: model.alias,
    modelId,
    generationProfile,
    siblingGroupId: source.siblingGroupId
  })

  const finished = await runGenerationFromPrepared(attempt.id, user.id, mockMode)
  return { attempt: finished }
})
