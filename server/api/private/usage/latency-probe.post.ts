import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import {
  acceptAttempt,
  createStorySession,
  listStorySessions,
  setSessionArchived
} from '../../../utils/nsfwStorage.ts'
import { listNarrativeModelCatalog } from '../../../services/nsfw/modelCatalog.ts'
import { runGeneration } from '../../../services/nsfw/generationOrchestrator.ts'
import { getStorage } from '../../../utils/storage.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const body = (await readBody(event).catch(() => ({}))) as {
    modelAlias?: string
    profiles?: Array<'quick' | 'quality'>
  }
  const catalog = listNarrativeModelCatalog()
  const modelAlias = body.modelAlias || catalog[0]?.alias
  if (!modelAlias) throw createError({ statusCode: 400, statusMessage: 'Sin modelos' })

  const settings = getStorage().readSettings()
  const mockMode = Boolean(settings?.value.mockMode)
  const profiles = body.profiles?.length ? body.profiles : (['quick', 'quality'] as const)

  const session = createStorySession(user.id, {
    title: 'Latency probe',
    premise: 'Medición de latencia Quick/Quality.',
    format: 'story',
    duration: 'short',
    tone: 'sensual',
    perspective: 'second',
    interactionPolicy: 'pause',
    generationProfile: 'quick',
    modelAlias,
    interests: [],
    exclusions: [],
    cast: [
      {
        actorId: 'protagonist',
        name: 'Tú',
        role: 'protagonist',
        personality: '',
        isSelfInsert: true
      }
    ]
  })

  const results: Array<{
    profile: 'quick' | 'quality'
    latencyMs: number
    state: string
    mockMode: boolean
    modelAlias: string
  }> = []

  try {
    let current = session
    for (const profile of profiles) {
      const started = Date.now()
      const attempt = await runGeneration({
        sessionId: current.id,
        ownerUserId: user.id,
        input: { kind: 'continue', text: '' },
        modelAlias,
        generationProfile: profile
      })
      if (attempt.state === 'ready') {
        const play = acceptAttempt(current, attempt)
        current = play.session
      }
      results.push({
        profile,
        latencyMs: attempt.latencyMs || Date.now() - started,
        state: attempt.state,
        mockMode,
        modelAlias
      })
    }
  } finally {
    setSessionArchived(session.id, user.id, true)
  }

  return {
    measuredAt: Date.now(),
    mockMode,
    modelAlias,
    results,
    note: mockMode
      ? 'Medido en mockMode. Desactiva mock en Ajustes para medir LM Studio real.'
      : 'Medido contra el runtime LLM configurado.',
    sessionsActive: listStorySessions(user.id).length
  }
})
