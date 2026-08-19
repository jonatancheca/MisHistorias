import type { Sound } from '#shared/types'
import { sanitizeTags, tagKey } from './tags.ts'

export interface DefaultSoundDefinition {
  id: string
  file: string
  tags: string[]
  introducedVersion: number
}

export const DEFAULT_SOUND_VERSION = 1
export const DEFAULT_SOUND_CREATED_AT = Date.UTC(2026, 7, 19, 12, 0, 0)

export const DEFAULT_SOUNDS: DefaultSoundDefinition[] = [
  { id: 'default-sound-steps', file: 'pasos.wav', tags: ['pasos', 'caminar'], introducedVersion: 1 },
  { id: 'default-sound-open-door', file: 'abrir-puerta.wav', tags: ['abrir puerta', 'puerta abre'], introducedVersion: 1 },
  { id: 'default-sound-close-door', file: 'cerrar-puerta.wav', tags: ['cerrar puerta', 'puerta cierra'], introducedVersion: 1 },
  { id: 'default-sound-doorbell', file: 'timbre.wav', tags: ['timbre', 'timbre puerta'], introducedVersion: 1 },
  { id: 'default-sound-door-knocks', file: 'golpes-puerta.wav', tags: ['golpes puerta', 'llamar puerta'], introducedVersion: 1 },
  { id: 'default-sound-rain', file: 'lluvia.wav', tags: ['lluvia'], introducedVersion: 1 },
  { id: 'default-sound-wind', file: 'viento.wav', tags: ['viento'], introducedVersion: 1 },
  { id: 'default-sound-thunder', file: 'trueno.wav', tags: ['trueno', 'tormenta'], introducedVersion: 1 },
  { id: 'default-sound-fire', file: 'fuego.wav', tags: ['fuego', 'hoguera'], introducedVersion: 1 },
  { id: 'default-sound-crowd', file: 'multitud.wav', tags: ['multitud', 'gente'], introducedVersion: 1 }
]

export function planDefaultSoundSeeds(
  existing: Array<Pick<Sound, 'id' | 'tags'>>,
  appliedVersion: number
) {
  if (appliedVersion >= DEFAULT_SOUND_VERSION) return []

  const ids = new Set(existing.map((sound) => sound.id))
  const usedTags = new Set(existing.flatMap((sound) => sound.tags).map(tagKey))
  const seeds: DefaultSoundDefinition[] = []

  for (const definition of DEFAULT_SOUNDS) {
    if (definition.introducedVersion <= appliedVersion || ids.has(definition.id)) continue
    const tags = sanitizeTags(definition.tags).filter((tag) => !usedTags.has(tagKey(tag)))
    if (!tags[0] || tagKey(tags[0]) !== tagKey(definition.tags[0]!)) continue
    tags.forEach((tag) => usedTags.add(tagKey(tag)))
    seeds.push({ ...definition, tags })
  }

  return seeds
}
