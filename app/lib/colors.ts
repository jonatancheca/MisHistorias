/** Paleta por defecto para asignar color a personajes nuevos. */
export const CHARACTER_COLORS = [
  '#ec4899',
  '#8b5cf6',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#14b8a6',
  '#a855f7'
]

export const DEFAULT_CHARACTER_COLOR = CHARACTER_COLORS[0]!
export const DEFAULT_USER_COLOR = '#0ea5e9'

const HEX_RE = /^#[0-9a-f]{6}$/i

export function normalizeColor(value: string | null | undefined, fallback: string) {
  return typeof value === 'string' && HEX_RE.test(value.trim()) ? value.trim().toLowerCase() : fallback
}

export function pickColor(index: number) {
  return CHARACTER_COLORS[index % CHARACTER_COLORS.length]!
}
