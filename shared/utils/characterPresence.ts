import type { Story } from '../types/index.ts'

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
