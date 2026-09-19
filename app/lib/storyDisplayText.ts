/**
 * Oculta anotaciones entre corchetes solo al presentar la historia.
 *
 * El texto original y sus segmentos se conservan: las etiquetas siguen
 * resolviendo personajes, fondos, sonidos e imágenes. También se oculta un
 * bloque abierto al final para no enseñar su contenido durante el streaming.
 */
export function stripBracketedText(value: string) {
  let visible = ''
  let depth = 0

  for (const character of value) {
    if (character === '[') {
      depth += 1
      continue
    }
    if (character === ']' && depth > 0) {
      depth -= 1
      continue
    }
    if (depth === 0) visible += character
  }

  return visible
    .replace(/[ \t]+(\r?\n)/g, '$1')
    .replace(/(\r?\n)[ \t]+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}
