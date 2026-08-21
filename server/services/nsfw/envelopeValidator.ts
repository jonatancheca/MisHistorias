import type { GenerationEnvelope, SuggestedInteraction, VisibleUnit } from '../../shared/types/nsfw/envelope.ts'
import type { NsfwStoryFormat, SessionCastMember } from '../../shared/types/nsfw/session.ts'

export interface EnvelopeValidationContext {
  format: NsfwStoryFormat
  cast: SessionCastMember[]
  exclusions: string[]
}

export interface EnvelopeValidationResult {
  ok: boolean
  errors: string[]
  envelope: GenerationEnvelope | null
}

const STOP_REASONS = new Set([
  'awaiting_player',
  'natural_pause',
  'choice_required',
  'scene_complete'
])

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function sanitizeText(value: string) {
  let cleaned = ''
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code === 9 || code === 10 || code === 13 || code >= 32) cleaned += char
  }
  return cleaned.replace(/<[^>]*>/g, '').trim()
}

function parseVisibleUnit(value: unknown, actorIds: Set<string>, errors: string[]): VisibleUnit | null {
  const row = asRecord(value)
  if (!row) {
    errors.push('Unidad visible no válida')
    return null
  }
  const type = text(row.type)
  const content = sanitizeText(text(row.text))
  if (!content) {
    errors.push('Texto vacío en unidad visible')
    return null
  }
  if (type === 'narration') return { type: 'narration', text: content }
  if (type === 'dialogue') {
    const actorId = text(row.actorId)
    if (!actorIds.has(actorId)) {
      errors.push(`actorId desconocido: ${actorId || '(vacío)'}`)
      return null
    }
    const unit: VisibleUnit = { type: 'dialogue', actorId, text: content }
    if (Array.isArray(row.spriteQuery)) {
      unit.spriteQuery = row.spriteQuery.filter((item): item is string => typeof item === 'string')
    }
    if (typeof row.speech === 'string' && row.speech.trim()) {
      unit.speech = sanitizeText(row.speech)
    }
    return unit
  }
  errors.push(`Tipo de unidad no válido: ${type}`)
  return null
}

function parseChoice(value: unknown, errors: string[]): SuggestedInteraction | null {
  const row = asRecord(value)
  if (!row) {
    errors.push('Choice no válida')
    return null
  }
  const id = text(row.id).trim() || cryptoRandomId()
  const kind = text(row.kind)
  const label = sanitizeText(text(row.label))
  const prominence = text(row.prominence) === 'primary' ? 'primary' : 'secondary'
  if (!label || (kind !== 'speak' && kind !== 'act' && kind !== 'choice')) {
    errors.push('Choice incompleta')
    return null
  }
  return { id, kind, label, prominence }
}

function cryptoRandomId() {
  return `choice-${Math.random().toString(36).slice(2, 10)}`
}

function containsExclusion(textValue: string, exclusions: string[]) {
  const haystack = textValue.toLocaleLowerCase()
  return exclusions.some((item) => {
    const needle = item.trim().toLocaleLowerCase()
    return needle.length > 1 && haystack.includes(needle)
  })
}

export function parseAndValidateEnvelope(
  raw: unknown,
  context: EnvelopeValidationContext
): EnvelopeValidationResult {
  const errors: string[] = []
  const root = asRecord(raw)
  if (!root) return { ok: false, errors: ['Envelope no es un objeto'], envelope: null }

  if (root.schemaVersion !== 1) errors.push('schemaVersion debe ser 1')
  if (root.language !== 'es-ES') errors.push('language debe ser es-ES')
  if (root.format !== context.format) errors.push('format no coincide con la sesión')
  if (!STOP_REASONS.has(text(root.stopReason))) errors.push('stopReason no válido')

  const actorIds = new Set(context.cast.map((member) => member.actorId))
  const visibleUnits: VisibleUnit[] = []
  if (!Array.isArray(root.visibleUnits) || root.visibleUnits.length === 0) {
    errors.push('visibleUnits vacío')
  } else {
    for (const item of root.visibleUnits) {
      const unit = parseVisibleUnit(item, actorIds, errors)
      if (unit) visibleUnits.push(unit)
    }
  }

  const choices: SuggestedInteraction[] = []
  if (Array.isArray(root.choices)) {
    for (const item of root.choices) {
      const choice = parseChoice(item, errors)
      if (choice) choices.push(choice)
    }
  }

  for (const unit of visibleUnits) {
    if (containsExclusion(unit.text, context.exclusions)) {
      errors.push('El texto incumple una exclusión de la sesión')
      break
    }
  }

  const envelope: GenerationEnvelope = {
    schemaVersion: 1,
    language: 'es-ES',
    format: context.format,
    visibleUnits,
    visualCues: Array.isArray(root.visualCues) ? (root.visualCues as GenerationEnvelope['visualCues']) : [],
    soundCues: Array.isArray(root.soundCues) ? (root.soundCues as GenerationEnvelope['soundCues']) : [],
    choices,
    stateDelta: Array.isArray(root.stateDelta)
      ? (root.stateDelta as GenerationEnvelope['stateDelta'])
      : [],
    planPatch: Array.isArray(root.planPatch)
      ? (root.planPatch as GenerationEnvelope['planPatch'])
      : [],
    stopReason: text(root.stopReason) as GenerationEnvelope['stopReason']
  }

  return { ok: errors.length === 0, errors, envelope: errors.length === 0 ? envelope : envelope }
}

export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('Respuesta vacía')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1))
    }
    throw new Error('No se encontró JSON válido')
  }
}

export function envelopeToProse(envelope: GenerationEnvelope) {
  return envelope.visibleUnits
    .map((unit) => {
      if (unit.type === 'narration') return unit.text
      return `— ${unit.text}`
    })
    .join('\n\n')
}
