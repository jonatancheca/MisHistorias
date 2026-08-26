import type { GenerationEnvelope } from '../../../shared/types/nsfw/envelope.ts'
import type { NsfwStorySession, PlayerInput } from '../../../shared/types/nsfw/session.ts'
import { BANNED_PHRASES } from './narrativeRag.ts'

export interface QualityPassResult {
  name: 'planner' | 'writer' | 'critic' | 'revision' | 'validator'
  ok: boolean
  latencyMs: number
  notes: string
  score?: number
}

export interface QualityPipelineResult {
  envelope: GenerationEnvelope
  passes: QualityPassResult[]
  revised: boolean
}

function scoreEnvelope(session: NsfwStorySession, envelope: GenerationEnvelope) {
  let score = 70
  if (envelope.visibleUnits.length >= 2) score += 8
  if (envelope.choices.length >= 2) score += 6
  if (envelope.stopReason === 'awaiting_player' || envelope.stopReason === 'choice_required') score += 6
  const dialogue = envelope.visibleUnits.filter((unit) => unit.type === 'dialogue')
  if (dialogue.length > 0) score += 5
  const forbidden = session.exclusions.map((item) => item.toLocaleLowerCase())
  const prose = envelope.visibleUnits.map((unit) => unit.text).join(' ').toLocaleLowerCase()
  if (forbidden.some((term) => term && prose.includes(term))) score -= 40
  if (BANNED_PHRASES.some((phrase) => prose.includes(phrase))) score -= 10
  const lastUnit = envelope.visibleUnits[envelope.visibleUnits.length - 1]
  if (lastUnit?.type === 'narration' && lastUnit.text.trim().endsWith('?')) score -= 10
  return Math.max(0, Math.min(100, score))
}

export function runMockQualityPipeline(
  session: NsfwStorySession,
  input: PlayerInput,
  buildEnvelope: (session: NsfwStorySession, input: PlayerInput) => GenerationEnvelope
): QualityPipelineResult {
  const passes: QualityPassResult[] = []
  const t0 = Date.now()
  const intent = input.text.trim() || `continuar desde ${session.worldState.location}`
  passes.push({
    name: 'planner',
    ok: true,
    latencyMs: 4,
    notes: `intent=${intent.slice(0, 120)}; checklist=cast+exclusions+stop`
  })

  let envelope = buildEnvelope(session, input)
  passes.push({
    name: 'writer',
    ok: true,
    latencyMs: Math.max(1, Date.now() - t0),
    notes: `units=${envelope.visibleUnits.length}`
  })

  const criticScore = scoreEnvelope(session, envelope)
  const criticOk = criticScore >= 72
  passes.push({
    name: 'critic',
    ok: criticOk,
    latencyMs: 3,
    notes: criticOk ? 'umbrales OK' : 'bajo umbral literatura/agencia',
    score: criticScore
  })

  let revised = false
  if (!criticOk) {
    revised = true
    envelope = {
      ...envelope,
      visibleUnits: [
        ...envelope.visibleUnits,
        {
          type: 'narration',
          text: 'El gesto se detiene un instante: todavía puedes elegir sin que la escena te arrastre.'
        }
      ],
      stopReason: 'awaiting_player'
    }
    passes.push({
      name: 'revision',
      ok: true,
      latencyMs: 2,
      notes: 'refuerzo de agencia y pausa'
    })
  }

  const validatedScore = scoreEnvelope(session, envelope)
  passes.push({
    name: 'validator',
    ok: validatedScore >= 72,
    latencyMs: 2,
    notes: `score=${validatedScore}; ids/state/plan chequeados`,
    score: validatedScore
  })

  return { envelope, passes, revised }
}
