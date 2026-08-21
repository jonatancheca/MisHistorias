export function currentRevealLineEnd(graphemes: readonly string[], visibleCount: number) {
  const safeVisibleCount = Math.min(Math.max(0, visibleCount), graphemes.length)
  const lineEnd = graphemes.indexOf('\n', safeVisibleCount)
  return lineEnd < 0 ? graphemes.length : lineEnd + 1
}

export interface RevealLine {
  start: number
  end: number
  text: string
}

export function currentRevealLine(
  graphemes: readonly string[],
  visibleCount: number
): RevealLine {
  const safeVisibleCount = Math.min(Math.max(0, visibleCount), graphemes.length)
  const previousLineEnd = graphemes.lastIndexOf('\n', Math.max(0, safeVisibleCount - 1))
  const start = previousLineEnd < 0 ? 0 : previousLineEnd + 1
  const end = currentRevealLineEnd(graphemes, safeVisibleCount)
  return {
    start,
    end,
    text: graphemes.slice(start, end).join('').replace(/\n$/, '')
  }
}

export function isHiddenVisualRevealLine(value: string) {
  const trimmed = value.trim()
  return (
    !trimmed ||
    /^Fondo\s*\[[^\]\n]+\]\s*:/i.test(trimmed) ||
    /^Sonido\s*\[[^\]\n]+\]\s*:/i.test(trimmed)
  )
}
