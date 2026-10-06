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

function markCharacterReturns(message: Message, absent: Set<string>) {
  let changed = false
  const segments: Message['segments'] = message.segments.map((segment) => {
    const { returnsToScene: _previousReturn, ...original } = segment
    if (message.role !== 'assistant' || message.swarmError ||
        (segment.type !== 'dialogue' && segment.type !== 'thought') ||
        !segment.characterId || !absent.has(segment.characterId) || !stripBracketedText(segment.text)) return original
    absent.delete(segment.characterId)
    changed = true
    return { ...original, returnsToScene: true }
  })
  return { message: { ...message, segments }, changed }
}

/** Reincorpora solo intervenciones con texto de una respuesta nueva, conservando su presencia inicial. */
export function restoreAbsentCharacters(message: Message, story: Story) {
  const absent = new Set(normalizeAbsentCharacterIds(story.absentCharacterIds, story.characterIds))
  const restored = markCharacterReturns(message, absent)
  return {
    message: restored.message,
    story: restored.changed ? { ...story, absentCharacterIds: [...absent], updatedAt: Date.now() } : story
  }
}

/** Editar conserva retornos ya registrados, sin provocar nuevos cambios de presencia. */
export function preserveCharacterReturns(message: Message, previous: Message) {
  const returned = new Set(previous.segments.flatMap((segment) =>
    segment.returnsToScene && segment.characterId ? [segment.characterId] : []
  ))
  return markCharacterReturns(message, returned).message
}
