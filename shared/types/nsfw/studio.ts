export interface NsfwStudioCharacter {
  id: string
  ownerUserId: string
  name: string
  tags: string[]
  color: string
  defaults: Record<string, string>
  published: boolean
  createdAt: number
  updatedAt: number
}

export interface NsfwStudioSprite {
  id: string
  characterId: string
  ownerUserId: string
  label: string
  facets: string[]
  mimeType: string
  createdAt: number
}

export interface NsfwStudioPlace {
  id: string
  ownerUserId: string
  name: string
  setting: string
  era: string
  tags: string[]
  published: boolean
  createdAt: number
  updatedAt: number
}

export interface NsfwStudioPlaceBackground {
  id: string
  placeId: string
  ownerUserId: string
  version: number
  active: boolean
  mimeType: string
  createdAt: number
}

export interface ExperienceSlot {
  id: string
  role: string
  required: boolean
  replaceable: boolean
  defaultCharacterId: string | null
}

export interface NsfwStudioExperience {
  id: string
  ownerUserId: string
  title: string
  premise: string
  slots: ExperienceSlot[]
  adultProfile: string
  planSeeds: string[]
  endings: string[]
  published: boolean
  createdAt: number
  updatedAt: number
}

export type HubResourceType = 'character' | 'place' | 'experience' | 'story'

export interface NsfwPublication {
  id: string
  ownerUserId: string
  ownerUsername: string
  resourceType: HubResourceType
  resourceId: string
  title: string
  summary: string
  tags: string[]
  status: 'published' | 'withdrawn'
  snapshotJson: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface NsfwLibraryEntry {
  id: string
  ownerUserId: string
  publicationId: string
  resourceType: HubResourceType
  title: string
  createdAt: number
}

export interface SpriteQuery {
  required: string[]
  preferred: Array<{ tag: string; weight: number }>
  excluded: string[]
}

export function selectSpriteByQuery(
  sprites: Array<{ id: string; facets: string[] }>,
  query: SpriteQuery
) {
  const excluded = new Set(query.excluded.map((tag) => tag.toLocaleLowerCase()))
  const required = query.required.map((tag) => tag.toLocaleLowerCase())
  let candidates = sprites.filter((sprite) => {
    const facets = sprite.facets.map((tag) => tag.toLocaleLowerCase())
    if (facets.some((tag) => excluded.has(tag))) return false
    return required.every((tag) => facets.includes(tag))
  })
  if (!candidates.length) {
    candidates = sprites.filter((sprite) => {
      const facets = sprite.facets.map((tag) => tag.toLocaleLowerCase())
      return !facets.some((tag) => excluded.has(tag))
    })
  }
  if (!candidates.length) return null

  let best = candidates[0]!
  let bestScore = -Infinity
  for (const sprite of candidates) {
    const facets = new Set(sprite.facets.map((tag) => tag.toLocaleLowerCase()))
    let score = 0
    for (const preferred of query.preferred) {
      if (facets.has(preferred.tag.toLocaleLowerCase())) score += preferred.weight
    }
    if (score > bestScore) {
      best = sprite
      bestScore = score
    }
  }
  return best
}
