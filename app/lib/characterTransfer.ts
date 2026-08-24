import type { Character } from '../../shared/types/index.ts'

export function exportCharacterTransferFields(character: Character) {
  return {
    id: character.id,
    name: character.name,
    prompt: character.prompt,
    tags: [...character.tags],
    color: character.color,
    imageGenerationPreset: character.imageGenerationPreset,
    archived: character.archived
  }
}

export function importImageGenerationPreset(value: unknown) {
  return typeof value === 'string' ? value : ''
}
