export interface CharacterImageCandidate {
  id: string
  characterId: string
  tags: string[]
  isDefault: boolean
}

export type RequestedImageTags = string | string[] | null | undefined

function normalizedTag(value: string) {
  return value.trim().toLocaleLowerCase('es')
}

export function normalizeRequestedImageTags(value: RequestedImageTags) {
  const values = Array.isArray(value) ? value : value ? [value] : []
  const seen = new Set<string>()
  const tags: string[] = []

  for (const candidate of values) {
    const tag = candidate.trim()
    const key = normalizedTag(tag)
    if (!key || seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }

  return tags
}

function imageTagKeys(image: CharacterImageCandidate) {
  return new Set(image.tags.map(normalizedTag).filter(Boolean))
}

function matchingTagCount(imageKeys: Set<string>, requestedKeys: Set<string>) {
  let count = 0
  for (const key of requestedKeys) {
    if (imageKeys.has(key)) count += 1
  }
  return count
}

function bestCharacterImageCandidates<T extends CharacterImageCandidate>(
  images: T[],
  characterId: string,
  requestedTags: RequestedImageTags
) {
  const own = images.filter((image) => image.characterId === characterId)
  const requested = normalizeRequestedImageTags(requestedTags)
  if (!requested.length) {
    const fallback = own.find((image) => image.isDefault) ?? own[0]
    return fallback ? [fallback] : []
  }

  const requestedKeys = new Set(requested.map(normalizedTag))
  const ranked = own.map((image) => {
    const imageKeys = imageTagKeys(image)
    const matches = matchingTagCount(imageKeys, requestedKeys)
    return {
      image,
      matches,
      extras: imageKeys.size - matches
    }
  })
  const bestScore = Math.max(0, ...ranked.map((candidate) => candidate.matches))
  if (bestScore === 0) {
    const fallback = own.find((image) => image.isDefault) ?? own[0]
    return fallback ? [fallback] : []
  }

  const bestMatches = ranked.filter((candidate) => candidate.matches === bestScore)
  const fewestExtras = Math.min(...bestMatches.map((candidate) => candidate.extras))
  return bestMatches
    .filter((candidate) => candidate.extras === fewestExtras)
    .map((candidate) => candidate.image)
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
  requestedTags: RequestedImageTags,
  seed = '',
  preferredImageId?: string | null
) {
  const candidates = bestCharacterImageCandidates(images, characterId, requestedTags)
  const preferred = preferredImageId
    ? candidates.find((candidate) => candidate.id === preferredImageId)
    : null
  if (preferred) return preferred
  if (!candidates.length) return null
  return candidates[seed ? stableIndex(seed, candidates.length) : 0]!
}
