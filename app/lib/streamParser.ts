import type { Background, Character, MessageSegment } from '#shared/types'

const LINE_RE = /^\s*([^:[\]\n]{1,60}?)\s*(?:\[([^\]\n]{1,40})\])?\s*:\s*([\s\S]*)$/
const BACKGROUND_RE = /^\s*Fondo\s*\[([^\]\n]{1,80})\]\s*:\s*([\s\S]*)$/i

function normalize(value: string) {
  return value.trim().toLowerCase()
}

/**
 * Parser tolerante: `Nombre [etiqueta]: texto` es diálogo, cualquier otra línea
 * es narración. Se reejecuta sobre el texto completo en cada chunk del stream.
 */
export function parseSegments(
  raw: string,
  characters: Character[],
  backgrounds: Background[] = []
): MessageSegment[] {
  const byName = new Map(characters.map((character) => [normalize(character.name), character]))
  const backgroundsByTag = new Map(
    backgrounds.map((background) => [normalize(background.tag), background])
  )
  const segments: MessageSegment[] = []

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue

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
      const [, rawName, rawTag, rest] = match
      const character = byName.get(normalize(rawName ?? ''))
      if (character) {
        segments.push({
          type: 'dialogue',
          characterId: character.id,
          tag: rawTag?.trim() ? rawTag.trim() : null,
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

export function serializeSegments(segments: MessageSegment[], characters: Character[]): string {
  const byId = new Map(characters.map((character) => [character.id, character]))
  return segments
    .map((segment) => {
      if (segment.type === 'background') {
        return `Fondo [${segment.tag ?? ''}]:${segment.text ? ` ${segment.text}` : ''}`
      }
      if (segment.type !== 'dialogue' || !segment.characterId) return segment.text
      const name = byId.get(segment.characterId)?.name ?? 'Personaje'
      return segment.tag ? `${name} [${segment.tag}]: ${segment.text}` : `${name}: ${segment.text}`
    })
    .join('\n')
}
