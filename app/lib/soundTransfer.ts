export const SOUND_DIRECTIVE_RE = /^\s*Sonido\s*\[[^\]\n]{1,80}\]\s*:/i

export function stripSoundDirectives(raw: string) {
  return raw
    .split('\n')
    .filter((line) => !SOUND_DIRECTIVE_RE.test(line))
    .join('\n')
}

export function stripSoundSegments<T extends { type: string }>(segments: T[]) {
  return segments.filter((segment) => segment.type !== 'sound')
}
