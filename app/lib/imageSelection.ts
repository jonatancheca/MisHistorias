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

function matchingTagCount(image: CharacterImageCandidate, requestedKeys: Set<string>) {
  const imageKeys = new Set(image.tags.map(normalizedTag))
  let count = 0
  for (const key of requestedKeys) {
    if (imageKeys.has(key)) count += 1
  }
  return count
}

export function imageMatchesAnyRequestedTag(
  image: CharacterImageCandidate,
  requestedTags: RequestedImageTags
) {
  const normalized = normalizeRequestedImageTags(requestedTags)
  if (!normalized.length) return true
  return matchingTagCount(image, new Set(normalized.map(normalizedTag))) > 0
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
  seed = ''
) {
  const own = images.filter((image) => image.characterId === characterId)
  const requested = normalizeRequestedImageTags(requestedTags)
  if (!requested.length) return own.find((image) => image.isDefault) ?? own[0] ?? null

  const requestedKeys = new Set(requested.map(normalizedTag))
  const ranked = own.map((image) => ({
    image,
    matches: matchingTagCount(image, requestedKeys)
  }))
  const exact = ranked.filter((candidate) => candidate.matches === requestedKeys.size)
  const bestScore = Math.max(0, ...ranked.map((candidate) => candidate.matches))
  const candidates = exact.length
    ? exact
    : ranked.filter((candidate) => candidate.matches === bestScore && bestScore > 0)

  if (!candidates.length) return null
  return candidates[seed ? stableIndex(seed, candidates.length) : 0]!.image
}
