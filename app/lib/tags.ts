export function tagKey(value: string) {
  return value.trim().toLocaleLowerCase()
}

export function sanitizeTags(values: unknown, legacyValue?: unknown, fallback?: string) {
  const candidates = Array.isArray(values)
    ? values
    : typeof values === 'string'
      ? values.split(',')
      : legacyValue === undefined
        ? []
        : [legacyValue]
  const seen = new Set<string>()
  const tags: string[] = []

  for (const candidate of candidates) {
    const tag = String(candidate ?? '').trim()
    const key = tagKey(tag)
    if (!key || seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }

  if (tags.length === 0 && fallback) tags.push(fallback)
  return tags
}

export function primaryTag(item: { tags: string[] } | null | undefined) {
  return item?.tags[0] ?? null
}

export function hasTag(item: { tags: string[] }, value: string) {
  const key = tagKey(value)
  return item.tags.some((tag) => tagKey(tag) === key)
}

export function nextAvailableTag(base: string, used: Set<string>) {
  let candidate = base
  let suffix = 2
  while (used.has(tagKey(candidate))) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}
