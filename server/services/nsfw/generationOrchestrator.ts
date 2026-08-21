import { buildMockEnvelope, buildStoryPromptBundle } from './promptBundle.ts'
import { runMockQualityPipeline } from './qualityPipeline.ts'
import { skillVersionMap } from './skills.ts'
import { fetchProxyChat } from '../../utils/llm.ts'
import { getStorage } from '../../utils/storage.ts'
import {
  createAttempt,
  getAttempt,
  getPlayState,
  getStorySession,
  updateAttempt
} from '../../utils/nsfwStorage.ts'
import { resolveModelByAlias } from './modelCatalog.ts'
import {
  envelopeToProse,
  extractJsonObject,
  parseAndValidateEnvelope
} from './envelopeValidator.ts'
import type {
  GenerationProfile,
  NsfwGenerationAttempt,
  NsfwStorySession,
  PlayerInput
} from '../../../shared/types/nsfw/session.ts'

export async function runGeneration(params: {
  sessionId: string
  ownerUserId: string
  input: PlayerInput
  modelAlias: string
  generationProfile: GenerationProfile
}) {
  const session = getStorySession(params.sessionId, params.ownerUserId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })
  if (session.format !== 'story' && session.format !== 'chat' && session.format !== 'vn') {
    throw createError({ statusCode: 400, statusMessage: 'Formato no soportado' })
  }

  const model = resolveModelByAlias(params.modelAlias)
  if (!model || !model.enabled) {
    throw createError({ statusCode: 400, statusMessage: 'Modelo no configurado' })
  }

  const input =
    session.interactionPolicy === 'non_interactive' && !params.input.text.trim()
      ? { ...params.input, kind: 'continue' as const, text: '' }
      : params.input

  const settings = getStorage().readSettings()
  const mockMode = Boolean(settings?.value.mockMode)
  const modelId = mockMode ? `mock:${model.lmStudioModelId}` : model.lmStudioModelId

  const attempt = createAttempt({
    session,
    input,
    modelAlias: model.alias,
    modelId,
    generationProfile: params.generationProfile,
    skillVersions: skillVersionMap(session.format, session)
  })

  return executeAttempt(attempt.id, params.ownerUserId, mockMode)
}

export async function runGenerationFromPrepared(
  attemptId: string,
  ownerUserId: string,
  mockMode: boolean
) {
  return executeAttempt(attemptId, ownerUserId, mockMode)
}

export async function retryAttempt(attemptId: string, ownerUserId: string) {
  const attempt = getAttempt(attemptId, ownerUserId)
  if (!attempt) throw createError({ statusCode: 404, statusMessage: 'Intento no encontrado' })
  if (attempt.state !== 'failed') {
    throw createError({ statusCode: 409, statusMessage: 'Solo se reintenta un fallo' })
  }
  if (attempt.retryCount >= 1) {
    throw createError({ statusCode: 409, statusMessage: 'Ya se usó el reintento automático' })
  }
  updateAttempt(attemptId, { state: 'requested', errorMessage: null, retryCount: attempt.retryCount + 1 })
  const settings = getStorage().readSettings()
  return executeAttempt(attemptId, ownerUserId, Boolean(settings?.value.mockMode))
}

async function executeAttempt(attemptId: string, ownerUserId: string, mockMode: boolean) {
  const started = Date.now()
  const attempt = getAttempt(attemptId, ownerUserId)
  if (!attempt) throw createError({ statusCode: 404, statusMessage: 'Intento no encontrado' })
  const session = getStorySession(attempt.sessionId, ownerUserId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })

  updateAttempt(attemptId, {
    state: 'streaming',
    provisionalText: '',
    skillVersions: attempt.skillVersions?.['narrative-rag']
      ? attempt.skillVersions
      : skillVersionMap(session.format, session)
  })

  try {
    let rawEnvelope: unknown
    let usage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
      passes: [] as NonNullable<NsfwGenerationAttempt['pipelinePasses']>
    }

    if (mockMode || attempt.modelId.startsWith('mock:')) {
      if (attempt.generationProfile === 'quality') {
        const pipeline = runMockQualityPipeline(session, attempt.input, buildMockEnvelope)
        updateAttempt(attemptId, {
          state: 'validating',
          provisionalText: envelopeToProse(pipeline.envelope),
          pipelinePasses: pipeline.passes
        })
        rawEnvelope = pipeline.envelope
        usage = {
          promptTokens: 220,
          completionTokens: 320,
          totalTokens: 540,
          latencyMs: Date.now() - started,
          passes: pipeline.passes
        }
      } else {
        const envelope = buildMockEnvelope(session, attempt.input)
        updateAttempt(attemptId, {
          state: 'validating',
          provisionalText: envelopeToProse(envelope),
          pipelinePasses: [
            { name: 'writer', ok: true, latencyMs: Date.now() - started, notes: 'quick mock' }
          ]
        })
        rawEnvelope = envelope
        usage = {
          promptTokens: 120,
          completionTokens: 180,
          totalTokens: 300,
          latencyMs: Date.now() - started,
          passes: [{ name: 'writer', ok: true, latencyMs: Date.now() - started, notes: 'quick mock' }]
        }
      }
    } else {
      const settings = getStorage().readSettings()
      const sampling =
        attempt.generationProfile === 'quality'
          ? resolveModelByAlias(attempt.modelAlias)?.qualityDefaults
          : resolveModelByAlias(attempt.modelAlias)?.quickDefaults
      const play = getPlayState(session.id, ownerUserId)
      const bundle = buildStoryPromptBundle(session, attempt.input, {
        recentBeats: play?.beats ?? []
      })

      if (attempt.generationProfile === 'quality') {
        const planner = await fetchProxyChat(
          {
            baseUrl: String(settings?.value.baseUrl ?? 'http://localhost:1234'),
            apiKey: settings?.apiKey ?? ''
          },
          {
            model: attempt.modelId,
            messages: [
              {
                role: 'system',
                content:
                  'Eres planner. Usa el método: anclar, cambio del beat, foco, agencia, intensidad, cuerpo/assets, cierre, extraer estado. Devuelve JSON breve: {intent, checklist, stopTarget}. Sin prosa narrativa.'
              },
              { role: 'user', content: bundle.messages[1]?.content || session.premise }
            ],
            temperature: 0.3,
            maxTokens: 256
          }
        )
        usage.passes!.push({
          name: 'planner',
          ok: true,
          latencyMs: Date.now() - started,
          notes: planner.content.slice(0, 200)
        })
      }

      const result = await fetchProxyChat(
        {
          baseUrl: String(settings?.value.baseUrl ?? 'http://localhost:1234'),
          apiKey: settings?.apiKey ?? ''
        },
        {
          model: attempt.modelId,
          messages: bundle.messages,
          temperature: sampling?.temperature ?? 0.9,
          maxTokens: sampling?.maxTokens ?? 512
        }
      )
      updateAttempt(attemptId, {
        state: 'validating',
        provisionalText: result.content.slice(0, 4000)
      })
      rawEnvelope = extractJsonObject(result.content)
      usage.promptTokens = Math.ceil(
        bundle.messages.reduce((sum, message) => sum + message.content.length, 0) / 4
      )
      usage.completionTokens = Math.ceil(result.content.length / 4)
      usage.totalTokens = usage.promptTokens + usage.completionTokens
      usage.passes!.push({
        name: 'writer',
        ok: true,
        latencyMs: Date.now() - started,
        notes: 'lmstudio writer'
      })
    }

    let validated = parseAndValidateEnvelope(rawEnvelope, {
      format: session.format,
      cast: session.cast,
      exclusions: session.exclusions
    })

    if (!validated.ok && attempt.retryCount < 1 && !mockMode) {
      updateAttempt(attemptId, { retryCount: attempt.retryCount + 1 })
      const repair = await repairEnvelope(session, attempt, String(rawEnvelope))
      validated = parseAndValidateEnvelope(repair, {
        format: session.format,
        cast: session.cast,
        exclusions: session.exclusions
      })
      usage.passes!.push({
        name: 'revision',
        ok: validated.ok,
        latencyMs: Date.now() - started,
        notes: 'repair json'
      })
    }

    usage.passes!.push({
      name: 'validator',
      ok: validated.ok,
      latencyMs: Date.now() - started,
      notes: validated.ok ? 'ok' : validated.errors.join('; ')
    })
    usage.latencyMs = Date.now() - started

    if (!validated.ok || !validated.envelope) {
      return updateAttempt(attemptId, {
        state: 'failed',
        errorMessage: validated.errors.join('; ') || 'Envelope inválido',
        usage,
        pipelinePasses: usage.passes,
        latencyMs: usage.latencyMs
      })!
    }

    return updateAttempt(attemptId, {
      state: 'ready',
      envelope: validated.envelope,
      provisionalText: envelopeToProse(validated.envelope),
      usage,
      pipelinePasses: usage.passes,
      latencyMs: usage.latencyMs,
      errorMessage: null
    })!
  } catch (caught) {
    return updateAttempt(attemptId, {
      state: 'failed',
      errorMessage: (caught as Error).message || 'Fallo de generación',
      latencyMs: Date.now() - started
    })!
  }
}

async function repairEnvelope(
  session: NsfwStorySession,
  attempt: NsfwGenerationAttempt,
  previous: string
) {
  const settings = getStorage().readSettings()
  const result = await fetchProxyChat(
    {
      baseUrl: String(settings?.value.baseUrl ?? 'http://localhost:1234'),
      apiKey: settings?.apiKey ?? ''
    },
    {
      model: attempt.modelId,
      temperature: 0.2,
      maxTokens: 512,
      messages: [
        {
          role: 'system',
          content:
            'Corrige el JSON para que cumpla Generation Envelope v1. Responde solo JSON válido.'
        },
        {
          role: 'user',
          content: `Formato=${session.format}. Reparto=${session.cast
            .map((member) => member.actorId)
            .join(',')}. JSON previo:\n${previous.slice(0, 6000)}`
        }
      ]
    }
  )
  return extractJsonObject(result.content)
}
