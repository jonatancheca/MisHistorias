import type { Message, Story } from '../types/index.ts'
import { stripBracketedText } from './storyDisplayText.ts'

/** La ausencia no retira al personaje del elenco. Los datos anteriores implican presencia. */
export function normalizeAbsentCharacterIds(value: unknown, characterIds: string[]): string[] {
  if (!Array.isArray(value)) return []
  const absent = new Set(value.filter((id): id is string => typeof id === 'string'))
  return characterIds.filter((id) => absent.has(id))
}

export function presentCharacterIds(story: Pick<Story, 'characterIds' | 'absentCharacterIds'>) {
  const absent = new Set(normalizeAbsentCharacterIds(story.absentCharacterIds, story.characterIds))
  return story.characterIds.filter((id) => !absent.has(id))
}

export function isPresenceSegment(segment: Pick<Message['segments'][number], 'type'>) {
  return segment.type === 'character-absent' || segment.type === 'character-present'
}

export function isPresenceDirectiveLine(value: string) {
  return /^\s*(Ausente|Presente)(?:\s|$)/i.test(value)
}

/** Guarda entradas y salidas en orden, conservando la presencia inicial de la respuesta. */
export function restoreAbsentCharacters(message: Message, story: Story) {
  const absent = new Set(normalizeAbsentCharacterIds(story.absentCharacterIds, story.characterIds))
  const cast = new Set(story.characterIds)
  let changed = false
  const segments = message.segments.map((segment) => {
    const { returnsToScene: _return, presenceApplied: _applied, ...original } = segment
    if (message.role !== 'assistant' || message.swarmError || !segment.characterId || !cast.has(segment.characterId)) return original
    if (isPresenceSegment(segment)) {
      const wasAbsent = absent.has(segment.characterId)
      if (segment.type === 'character-absent') absent.add(segment.characterId)
      else absent.delete(segment.characterId)
      changed ||= wasAbsent !== absent.has(segment.characterId)
      return { ...original, presenceApplied: true }
    }
    if ((segment.type === 'dialogue' || segment.type === 'thought') && absent.has(segment.characterId) && stripBracketedText(segment.text)) {
      absent.delete(segment.characterId)
      changed = true
      return { ...original, returnsToScene: true }
    }
    return original
  })
  return {
    message: { ...message, segments },
    story: changed ? { ...story, absentCharacterIds: story.characterIds.filter((id) => absent.has(id)),
      pendingImageInstructions: story.pendingImageInstructions?.filter((instruction) => !absent.has(instruction.characterId)), updatedAt: Date.now() } : story
  }
}

/** Editar conserva los efectos registrados, sin crear salidas ni retornos nuevos. */
export function preserveCharacterReturns(message: Message, previous: Message) {
  const remaining = previous.segments.filter((segment) => isPresenceSegment(segment) && segment.presenceApplied)
  const returns = new Map<string, number>()
  for (const segment of previous.segments) {
    if (segment.returnsToScene && segment.characterId) returns.set(segment.characterId, (returns.get(segment.characterId) ?? 0) + 1)
  }
  const absent = new Set(previous.absentCharacterIds ?? returns.keys())
  const segments = message.segments.map((segment) => {
    const { returnsToScene: _return, presenceApplied: _applied, ...original } = segment
    if (message.role !== 'assistant' || message.swarmError || !segment.characterId) return original
    if (isPresenceSegment(segment)) {
      const index = remaining.findIndex((old) => old.type === segment.type && old.characterId === segment.characterId)
      if (index < 0) return original
      remaining.splice(index, 1)
      if (segment.type === 'character-absent') absent.add(segment.characterId)
      else absent.delete(segment.characterId)
      return { ...original, presenceApplied: true }
    }
    const count = returns.get(segment.characterId) ?? 0
    if ((segment.type === 'dialogue' || segment.type === 'thought') && count && absent.has(segment.characterId) && stripBracketedText(segment.text)) {
      returns.set(segment.characterId, count - 1)
      absent.delete(segment.characterId)
      return { ...original, returnsToScene: true }
    }
    return original
  })
  return { ...message, segments }
}
