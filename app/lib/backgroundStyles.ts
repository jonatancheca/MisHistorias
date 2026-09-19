import type { Background } from '#shared/types'

export function normalizeBackgroundStyle(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, ' ') ?? ''
}

export function backgroundStyleKey(value: string | null | undefined) {
  return normalizeBackgroundStyle(value).toLocaleLowerCase()
}

export function matchesBackgroundStyle(
  background: Pick<Background, 'style'>,
  selectedStyle: string | null | undefined
) {
  const selected = backgroundStyleKey(selectedStyle)
  return !selected || backgroundStyleKey(background.style) === selected
}

export function availableBackgroundStyles(backgrounds: Array<Pick<Background, 'style'>>) {
  const styles = new Map<string, string>()
  for (const background of backgrounds) {
    const style = normalizeBackgroundStyle(background.style)
    const key = backgroundStyleKey(style)
    if (style && !styles.has(key)) styles.set(key, style)
  }
  return [...styles.values()].sort((left, right) => left.localeCompare(right, 'es'))
}
