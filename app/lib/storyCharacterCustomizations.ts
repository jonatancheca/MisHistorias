import type { StoryCharacterCustomization } from '../../shared/types/index.ts'

export function storyCustomizationIds(
  characterIds: string[],
  customizations: StoryCharacterCustomization[]
) {
  return [...new Set([
    ...characterIds,
    ...customizations.map((customization) => customization.characterId)
  ])]
}

export function activeStoryCharacterCustomizations(
  characterIds: string[],
  customizations: StoryCharacterCustomization[]
) {
  const activeIds = new Set(characterIds)
  return customizations.filter((customization) => activeIds.has(customization.characterId))
}
