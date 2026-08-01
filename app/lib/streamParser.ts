import type { Character, MessageSegment } from '#shared/types'

const LINE_RE = /^\s*([^:[\]\n]{1,60}?)\s*(?:\[([^\]\n]{1,40})\])?\s*:\s*([\s\S]*)$/

function normalize(value: string) {
  return value.trim().toLowerCase()
}

/**
 * Parser tolerante: `Nombre [etiqueta]: texto` es diálogo, cualquier otra línea
 * es narración. Se reejecuta sobre el texto completo en cada chunk del stream.
 */
export function parseSegments(raw: string, characters: Character[]): MessageSegment[] {
  const byName = new Map(characters.map((character) => [normalize(character.name), character]))
  const segments: MessageSegment[] = []

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue

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
      if (segment.type !== 'dialogue' || !segment.characterId) return segment.text
      const name = byId.get(segment.characterId)?.name ?? 'Personaje'
      return segment.tag ? `${name} [${segment.tag}]: ${segment.text}` : `${name}: ${segment.text}`
    })
    .join('\n')
}
