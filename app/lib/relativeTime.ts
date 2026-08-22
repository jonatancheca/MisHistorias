const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000]
]

const formatter = new Intl.RelativeTimeFormat('es-ES', { numeric: 'auto', style: 'short' })

/** «hace 2 h», «ayer», «hace 2 sem.» para los metadatos de las listas privadas. */
export function relativeTime(timestamp: number, now = Date.now()) {
  const delta = timestamp - now
  const magnitude = Math.abs(delta)
  for (const [unit, size] of UNITS) {
    if (magnitude >= size) return formatter.format(Math.round(delta / size), unit)
  }
  return 'ahora'
}
