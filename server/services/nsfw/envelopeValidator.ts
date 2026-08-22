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

function normalizeLooseVisibleUnit(value: unknown): Record<string, unknown> | null {
  const row = asRecord(value)
  if (!row) return null

  if (text(row.type) === 'narration') {
    const content = sanitizeText(text(row.text) || text(row.narration))
    return content ? { type: 'narration', text: content } : null
  }
  if (text(row.type) === 'dialogue') {
    const content = sanitizeText(text(row.text) || text(row.dialogue) || text(row.speech))
    const actorId = text(row.actorId) || text(row.speakerId) || text(row.characterId)
    return content ? { type: 'dialogue', actorId, text: content, speech: text(row.speech) || undefined } : null
  }

  const nestedDialogue = asRecord(row.dialogue)
  if (nestedDialogue) {
    const content = sanitizeText(
      text(nestedDialogue.text) || text(nestedDialogue.dialogue) || text(nestedDialogue.speech)
    )
    const actorId =
      text(nestedDialogue.actorId) ||
      text(row.actorId) ||
      text(nestedDialogue.speakerId) ||
      text(nestedDialogue.characterId)
    if (content) return { type: 'dialogue', actorId, text: content }
  }

  const narration = sanitizeText(text(row.narration) || text(row.narrative) || text(row.prose))
  if (narration) return { type: 'narration', text: narration }

  const dialogue = sanitizeText(text(row.dialogue) || text(row.speech) || text(row.line))
  if (dialogue) {
    return {
      type: 'dialogue',
      actorId: text(row.actorId) || text(row.speakerId) || text(row.characterId),
      text: dialogue
    }
  }

  if (sanitizeText(text(row.text))) {
    if (text(row.actorId)) {
      return { type: 'dialogue', actorId: text(row.actorId), text: sanitizeText(text(row.text)) }
    }
    return { type: 'narration', text: sanitizeText(text(row.text)) }
  }
  return null
}

function normalizeLooseChoice(value: unknown): Record<string, unknown> | null {
  const row = asRecord(value)
  if (!row) return null
  const label = sanitizeText(
    text(row.label) || text(row.text) || text(row.prompt) || text(row.choice)
  )
  if (!label) return null
  let kind = text(row.kind)
  if (kind !== 'speak' && kind !== 'act' && kind !== 'choice') {
    const lower = label.toLocaleLowerCase()
    if (lower.startsWith('(') || lower.startsWith('[') || lower.includes('acerc')) kind = 'act'
    else if (label.includes('"') || label.includes('«') || lower.startsWith('decir')) kind = 'speak'
    else kind = 'choice'
  }
  return {
    id: text(row.id).trim() || cryptoRandomId(),
    kind,
    label,
    prominence: text(row.prominence) === 'primary' ? 'primary' : 'secondary'
  }
}

function normalizeStateDelta(value: unknown): GenerationEnvelope['stateDelta'] {
  if (Array.isArray(value)) {
    const ops: GenerationEnvelope['stateDelta'] = []
    for (const item of value) {
      const row = asRecord(item)
      if (!row) continue
      const op = text(row.op)
      if (op === 'set_location' && text(row.value)) {
        ops.push({ op: 'set_location', value: text(row.value) })
      } else if (op === 'set_mood' && text(row.value)) {
        ops.push({ op: 'set_mood', value: text(row.value) })
      } else if (op === 'set_present') {
        const actorIds = Array.isArray(row.actorIds)
          ? row.actorIds
          : Array.isArray(row.value)
            ? row.value
            : []
        ops.push({
          op: 'set_present',
          actorIds: actorIds.filter((entry): entry is string => typeof entry === 'string')
        })
      } else if (op === 'set_flag' && text(row.key)) {
        const flagValue = row.value
        if (
          typeof flagValue === 'string' ||
          typeof flagValue === 'number' ||
          typeof flagValue === 'boolean'
        ) {
          ops.push({ op: 'set_flag', key: text(row.key), value: flagValue })
        }
      } else if (op === 'add_relationship_note' && text(row.value)) {
        ops.push({ op: 'add_relationship_note', value: text(row.value) })
      }
    }
    return ops
  }
  const row = asRecord(value)
  if (!row) return []
  const ops: GenerationEnvelope['stateDelta'] = []
  const world = asRecord(row.worldState) || row
  const scene = asRecord(row.sceneState)

  const location = text(world.location) || text(scene?.location)
  if (location) ops.push({ op: 'set_location', value: location })
  const mood = text(world.mood)
  if (mood) ops.push({ op: 'set_mood', value: mood })
  const present = Array.isArray(world.presentActorIds)
    ? world.presentActorIds
    : Array.isArray(scene?.presentActorIds)
      ? scene?.presentActorIds
      : []
  if (Array.isArray(present) && present.length) {
    ops.push({
      op: 'set_present',
      actorIds: present.filter((item): item is string => typeof item === 'string')
    })
  }
  const flags = asRecord(world.flags)
  if (flags) {
    for (const [key, flagValue] of Object.entries(flags)) {
      if (
        typeof flagValue === 'string' ||
        typeof flagValue === 'number' ||
        typeof flagValue === 'boolean'
      ) {
        ops.push({ op: 'set_flag', key, value: flagValue })
      }
    }
  }
  return ops
}

/** Tolerates common LM Studio shape drift before strict validation. */
export function normalizeLooseEnvelope(
  raw: unknown,
  format: NsfwStoryFormat
): Record<string, unknown> | null {
  const root = asRecord(raw)
  if (!root) return null

  const visibleUnits = Array.isArray(root.visibleUnits)
    ? root.visibleUnits
        .map((item) => normalizeLooseVisibleUnit(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : []

  const choices = Array.isArray(root.choices)
    ? root.choices
        .map((item) => normalizeLooseChoice(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : []

  let stopReason = text(root.stopReason)
  if (!STOP_REASONS.has(stopReason)) stopReason = 'awaiting_player'
  if (stopReason === 'choice_required' && choices.length === 0) {
    stopReason = 'awaiting_player'
  }

  return {
    ...root,
    schemaVersion: 1,
    language: 'es-ES',
    format,
    visibleUnits,
    visualCues: Array.isArray(root.visualCues) ? root.visualCues : [],
    soundCues: Array.isArray(root.soundCues)
      ? root.soundCues.filter((item) => {
          const cue = asRecord(item)
          return Boolean(cue && typeof cue.assetId === 'string' && cue.assetId.trim())
        })
      : [],
    choices,
    stateDelta: normalizeStateDelta(root.stateDelta),
    planPatch: Array.isArray(root.planPatch) ? root.planPatch : [],
    stopReason
  }
}

export function prosePreviewFromRaw(raw: unknown, format: NsfwStoryFormat) {
  const normalized = normalizeLooseEnvelope(raw, format)
  if (!normalized || !Array.isArray(normalized.visibleUnits)) return ''
  return normalized.visibleUnits
    .map((unit) => {
      const row = asRecord(unit)
      if (!row) return ''
      if (text(row.type) === 'dialogue') return `— ${text(row.text)}`
      return text(row.text)
    })
    .filter(Boolean)
    .join('\n\n')
}

export function parseAndValidateEnvelope(
  raw: unknown,
  context: EnvelopeValidationContext
): EnvelopeValidationResult {
  const errors: string[] = []
  const normalized = normalizeLooseEnvelope(raw, context.format)
  const root = normalized
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
    visualCues: Array.isArray(root.visualCues)
      ? (root.visualCues as GenerationEnvelope['visualCues'])
      : [],
    soundCues: Array.isArray(root.soundCues)
      ? (root.soundCues as GenerationEnvelope['soundCues'])
      : [],
    choices,
    stateDelta: Array.isArray(root.stateDelta)
      ? (root.stateDelta as GenerationEnvelope['stateDelta'])
      : [],
    planPatch: Array.isArray(root.planPatch)
      ? (root.planPatch as GenerationEnvelope['planPatch'])
      : [],
    stopReason: text(root.stopReason) as GenerationEnvelope['stopReason']
  }

  return { ok: errors.length === 0, errors, envelope: errors.length === 0 ? envelope : null }
}

export function extractJsonObject(raw: string): unknown {
  let trimmed = raw.trim()
  if (!trimmed) throw new Error('Respuesta vacía')
  // Quita fences markdown ```json ... ```
  trimmed = trimmed
    .replace(/^```(?:json|JSON)?\s*/u, '')
    .replace(/\s*```$/u, '')
    .trim()
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
