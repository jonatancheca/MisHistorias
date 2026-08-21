import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import { runGeneration } from '../../../../services/nsfw/generationOrchestrator.ts'
import type { GenerationProfile, PlayerInput } from '../../../../../shared/types/nsfw/session.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })
  const body = (await readBody(event)) as Record<string, unknown>
  const inputRaw = body.input && typeof body.input === 'object' ? (body.input as Record<string, unknown>) : {}
  const kind = typeof inputRaw.kind === 'string' ? inputRaw.kind : 'continue'
  const input: PlayerInput = {
    kind: kind as PlayerInput['kind'],
    text: typeof inputRaw.text === 'string' ? inputRaw.text : '',
    choiceId: typeof inputRaw.choiceId === 'string' ? inputRaw.choiceId : undefined
  }
  const attempt = await runGeneration({
    sessionId: id,
    ownerUserId: user.id,
    input,
    modelAlias:
      (typeof body.modelAlias === 'string' && body.modelAlias.trim()) ||
      '',
    generationProfile: (typeof body.generationProfile === 'string'
      ? body.generationProfile
      : 'quick') as GenerationProfile
  })
  return { attempt }
})
