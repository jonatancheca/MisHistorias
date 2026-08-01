import type { Character } from '#shared/types'
import type { StoredBackground, StoredImage } from '~/lib/db'

const NARRATION_LINES = [
  'La sala huele a polvo y a papel viejo.',
  'Una bombilla parpadea sobre sus cabezas.',
  'Fuera, la lluvia golpea los cristales.',
  'Algo se mueve al fondo del pasillo.',
  'El suelo cruje con cada paso.',
  'Un reloj marca la hora en algún sitio.',
  'La puerta se cierra sola, sin ruido.',
  'El aire se vuelve más frío de golpe.',
  'Las sombras se alargan por la pared.',
  'Nadie se atreve a decir nada durante unos segundos.'
]

const DIALOGUE_LINES = [
  '¿Habéis oído eso?',
  'No pienso quedarme aquí ni un minuto más.',
  'Esto no estaba en el plan.',
  'Dame la linterna, deprisa.',
  'Yo he estado antes en este sitio.',
  'Cállate y escucha.',
  'Tenemos que salir por donde hemos entrado.',
  'No me fío ni un pelo.',
  'Creo que hay alguien más aquí.',
  'Vale. Respiremos y pensemos.',
  'Eso de ahí no es una sombra.',
  'Si nos separamos, estamos muertos.'
]

function randomInt(min: number, max: number) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap]!, copy[index]!]
  }
  return copy
}

function tagsOf(characterId: string, images: StoredImage[]) {
  const own = images
    .filter((image) => image.characterId === characterId)
    .flatMap((image) => image.tags)
  return own.length ? own : ['neutral']
}

/**
 * Genera una respuesta falsa con el mismo formato que se le pide al modelo:
 * número aleatorio de personajes, hasta 3 intervenciones cada uno y varias
 * líneas de narración intercaladas.
 */
export function buildMockResponse(
  characters: Character[],
  images: StoredImage[],
  backgrounds: StoredBackground[],
  initialBackgroundId: string | null
): string {
  const lines: string[] = []

  if (backgrounds.length && (!initialBackgroundId || Math.random() < 0.5)) {
    const available = backgrounds.filter((background) => background.id !== initialBackgroundId)
    const background = pick(available.length ? available : backgrounds)
    lines.push(`Fondo [${pick(background.tags)}]:`)
  }

  const speakers = shuffle(characters).slice(0, randomInt(1, Math.min(3, characters.length || 1)))
  for (const speaker of speakers) {
    const tags = tagsOf(speaker.id, images)
    for (let turn = 0; turn < randomInt(1, 3); turn += 1) {
      lines.push(`${speaker.name} [${pick(tags)}]: ${pick(DIALOGUE_LINES)}`)
    }
  }

  for (let index = 0; index < randomInt(1, 3); index += 1) {
    lines.push(pick(NARRATION_LINES))
  }

  const shuffled = shuffle(lines)
  return shuffled.length ? shuffled.join('\n') : pick(NARRATION_LINES)
}
