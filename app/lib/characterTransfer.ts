import type { Character } from '../../shared/types/index.ts'

export function exportCharacterTransferFields(character: Character) {
  return {
    id: character.id,
    name: character.name,
    prompt: character.prompt,
    tags: [...character.tags],
    color: character.color,
    imageGenerationPreset: character.imageGenerationPreset,
    imageGenerationLora: character.imageGenerationLora,
    imageGenerationSeed: character.imageGenerationSeed,
    imageGenerationPromptPrefix: character.imageGenerationPromptPrefix,
    archived: character.archived
  }
}

export function importImageGenerationPreset(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export function importImageGenerationLora(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export function importImageGenerationSeed(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export function importImageGenerationPromptPrefix(value: unknown) {
  return typeof value === 'string' ? value : ''
}
