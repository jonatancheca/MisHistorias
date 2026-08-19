import type { Background, Character, CharacterImage, MessageSegment, Sound } from '#shared/types'
import { tagKey } from '~/lib/tags'
import { normalizeRequestedImageTags, selectCharacterImage } from '~/lib/imageSelection'

const LINE_RE = /^\s*([^:[\]\n]{1,60}?)\s*((?:\s*\[[^\]\n]{1,40}\])*)\s*:\s*([\s\S]*)$/
const BACKGROUND_RE = /^\s*Fondo\s*\[([^\]\n]{1,80})\]\s*:\s*([\s\S]*)$/i
const SOUND_RE = /^\s*Sonido\s*\[([^\]\n]{1,80})\]\s*:\s*([\s\S]*)$/i
const DIALOGUE_TAG_RE = /\[([^\]\n]{1,40})\]/g

function normalize(value: string) {
  return tagKey(value)
}

function isVisualDirectiveLine(
  line: string,
  characters: Character[],
  protagonistName: string
) {
  const trimmed = line.trim()
  if (BACKGROUND_RE.test(trimmed) || SOUND_RE.test(trimmed)) return true

  const match = LINE_RE.exec(trimmed)
  if (!match) return false
  const name = normalize(match[1] ?? '')
  return (
    characters.some((character) => normalize(character.name) === name) ||
    (Boolean(protagonistName.trim()) && normalize(protagonistName) === name)
  )
}

export function hideIncompleteVisualDirectivePrefix(
  visibleRaw: string,
  completeRaw: string,
  characters: Character[],
  protagonistName = ''
) {
  if (!completeRaw.startsWith(visibleRaw) || visibleRaw.length >= completeRaw.length) {
    return visibleRaw
  }

  const lineStart = visibleRaw.lastIndexOf('\n') + 1
  const lineEnd = completeRaw.indexOf('\n', lineStart)
  const completeLine = completeRaw.slice(lineStart, lineEnd < 0 ? completeRaw.length : lineEnd)
  const separatorIndex = completeLine.indexOf(':')
  const visibleLineLength = visibleRaw.length - lineStart

  if (
    separatorIndex < 0 ||
    visibleLineLength > separatorIndex ||
    !isVisualDirectiveLine(completeLine, characters, protagonistName)
  ) {
    return visibleRaw
  }

  return visibleRaw.slice(0, lineStart)
}

export function parseDialogueTags(value: string) {
  return normalizeRequestedImageTags(
    Array.from(value.matchAll(DIALOGUE_TAG_RE), (match) => match[1] ?? '')
  )
}

/**
 * Parser tolerante: `Nombre [etiqueta]: texto` es diálogo, cualquier otra línea
 * es narración. Se reejecuta sobre el texto completo en cada chunk del stream.
 */
export function parseSegments(
  raw: string,
  characters: Character[],
  backgrounds: Background[] = [],
  protagonistName = '',
  images: CharacterImage[] = [],
  selectionSeed = '',
  sounds: Sound[] = []
): MessageSegment[] {
  const byName = new Map(characters.map((character) => [normalize(character.name), character]))
  const normalizedProtagonistName = normalize(protagonistName)
  const backgroundsByTag = new Map(
    backgrounds.flatMap((background) =>
      background.tags.map((tag) => [normalize(tag), background] as const)
    )
  )
  const soundsByTag = new Map(
    sounds.flatMap((sound) => sound.tags.map((tag) => [normalize(tag), sound] as const))
  )
  const segments: MessageSegment[] = []

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue

    const soundMatch = SOUND_RE.exec(trimmed)
    if (soundMatch) {
      const tag = (soundMatch[1] ?? '').trim()
      const sound = soundsByTag.get(normalize(tag))
      segments.push({
        type: 'sound',
        characterId: null,
        soundId: sound?.id ?? null,
        tag,
        text: (soundMatch[2] ?? '').trim()
      })
      continue
    }

    const backgroundMatch = BACKGROUND_RE.exec(trimmed)
    if (backgroundMatch) {
      const tag = (backgroundMatch[1] ?? '').trim()
      const background = backgroundsByTag.get(normalize(tag))
      segments.push({
        type: 'background',
        characterId: null,
        backgroundId: background?.id ?? null,
        tag,
        text: (backgroundMatch[2] ?? '').trim()
      })
      continue
    }

    const match = LINE_RE.exec(trimmed)
    if (match) {
      const [, rawName, rawTagBlock, rest] = match
      const character = byName.get(normalize(rawName ?? ''))
      if (character) {
        const tags = parseDialogueTags(rawTagBlock ?? '')
        segments.push({
          type: 'dialogue',
          characterId: character.id,
          tag: tags[0] ?? null,
          tags: tags.length ? tags : undefined,
          imageId: selectCharacterImage(
            images,
            character.id,
            tags,
            `${selectionSeed}:${segments.length}`
          )?.id ?? null,
          text: (rest ?? '').trim()
        })
        continue
      }
      if (normalizedProtagonistName && normalize(rawName ?? '') === normalizedProtagonistName) {
        segments.push({
          type: 'protagonist-dialogue',
          characterId: null,
          tag: null,
          text: (rest ?? '').trim()
        })
        continue
      }
    }

    const last = segments[segments.length - 1]
    if (last && last.type === 'narration') {
      last.text = `${last.text}\n${trimmed}`
      continue
    }
    segments.push({ type: 'narration', characterId: null, tag: null, text: trimmed })
  }

  return segments
}

export function serializeSegments(
  segments: MessageSegment[],
  characters: Character[],
  protagonistName = 'Usuario'
): string {
  const byId = new Map(characters.map((character) => [character.id, character]))
  return segments
    .map((segment) => {
      if (segment.type === 'background') {
        return `Fondo [${segment.tag ?? ''}]:${segment.text ? ` ${segment.text}` : ''}`
      }
      if (segment.type === 'sound') {
        return `Sonido [${segment.tag ?? ''}]:${segment.text ? ` ${segment.text}` : ''}`
      }
      if (segment.type === 'protagonist-dialogue') {
        return `${protagonistName}: ${segment.text}`
      }
      if (segment.type !== 'dialogue' || !segment.characterId) return segment.text
      const name = byId.get(segment.characterId)?.name ?? 'Personaje'
      const tags = normalizeRequestedImageTags(
        segment.tags?.length ? segment.tags : segment.tag
      )
      const tagBlock = tags.map((tag) => `[${tag}]`).join('')
      return tagBlock ? `${name} ${tagBlock}: ${segment.text}` : `${name}: ${segment.text}`
    })
    .join('\n')
}
