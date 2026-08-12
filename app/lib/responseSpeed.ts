import type { ResponseSpeed } from '#shared/types'

const RESPONSE_CHARACTERS_PER_SECOND: Record<Exclude<ResponseSpeed, 'instant'>, number> = {
  slow: 20,
  medium: 50,
  high: 100
}

const VISUAL_NOVEL_SLOW_CHARACTERS_PER_SECOND = 8

export function responseCharactersPerSecond(
  speed: Exclude<ResponseSpeed, 'instant'>,
  visualMode: boolean
) {
  return speed === 'slow' && visualMode
    ? VISUAL_NOVEL_SLOW_CHARACTERS_PER_SECOND
    : RESPONSE_CHARACTERS_PER_SECOND[speed]
}
