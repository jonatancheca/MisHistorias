export const SOUND_DIRECTIVE_RE = /^\s*Sonido\s*\[[^\]\n]{1,80}\]\s*:/i

export function stripSoundDirectives(raw: string) {
  return raw
    .split('\n')
    .filter((line) => !SOUND_DIRECTIVE_RE.test(line))
    .join('\n')
}

export function filterSoundDirectives(raw: string, allowedTags: Set<string>) {
  return raw
    .split('\n')
    .filter((line) => {
      const match = line.match(/^\s*Sonido\s*\[([^\]\n]{1,80})\]\s*:/i)
      return !match || allowedTags.has(match[1]!.trim().toLocaleLowerCase())
    })
    .join('\n')
}

export function stripSoundSegments<T extends { type: string }>(segments: T[]) {
  return segments.filter((segment) => segment.type !== 'sound')
}
