export function currentRevealLineEnd(graphemes: readonly string[], visibleCount: number) {
  const safeVisibleCount = Math.min(Math.max(0, visibleCount), graphemes.length)
  const lineEnd = graphemes.indexOf('\n', safeVisibleCount)
  return lineEnd < 0 ? graphemes.length : lineEnd + 1
}
