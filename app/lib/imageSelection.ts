export interface CharacterImageCandidate {
  id: string
  characterId: string
  tags: string[]
  isDefault: boolean
}

function normalizedTag(value: string) {
  return value.trim().toLocaleLowerCase('es')
}

export function stableIndex(seed: string, length: number) {
  if (length <= 0) return -1
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % length
}

export function selectCharacterImage<T extends CharacterImageCandidate>(
  images: T[],
  characterId: string,
  tag: string | null,
  seed = ''
) {
  const own = images.filter((image) => image.characterId === characterId)
  if (tag) {
    const key = normalizedTag(tag)
    const matches = own.filter((image) =>
      image.tags.some((candidate) => normalizedTag(candidate) === key)
    )
    if (matches.length) return matches[seed ? stableIndex(seed, matches.length) : 0]!
  }
  return own.find((image) => image.isDefault) ?? own[0] ?? null
}
