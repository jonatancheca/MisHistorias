import type { ResponseSpeed } from '#shared/types'

const RESPONSE_CHARACTERS_PER_SECOND: Record<Exclude<ResponseSpeed, 'instant'>, number> = {
  slow: 20,
  medium: 50,
  high: 100
}

const VISUAL_NOVEL_CHARACTERS_PER_SECOND = {
  slow: 8,
  medium: 20
} as const

export function responseCharactersPerSecond(
  speed: Exclude<ResponseSpeed, 'instant'>,
  visualMode: boolean
) {
  if (visualMode && speed in VISUAL_NOVEL_CHARACTERS_PER_SECOND) {
    return VISUAL_NOVEL_CHARACTERS_PER_SECOND[
      speed as keyof typeof VISUAL_NOVEL_CHARACTERS_PER_SECOND
    ]
  }
  return RESPONSE_CHARACTERS_PER_SECOND[speed]
}
