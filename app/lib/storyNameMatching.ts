interface NamedStoryParticipant {
  name: string
}

function exactNameKey(value: string) {
  return value.trim().toLocaleLowerCase('es').normalize('NFC')
}

function accentlessNameKey(value: string) {
  return value.normalize('NFD').replace(/n\u0303/g, '\u00f1').replace(/\p{M}/gu, '')
}

/** Resuelve nombres narrativos sin perder la prioridad exacta ni confundir participantes. */
export function createStoryNameResolver<T extends NamedStoryParticipant>(participants: T[]) {
  const exact = new Map<string, T>()
  const accentless = new Map<string, T | null>()
  for (const participant of participants) {
    const key = exactNameKey(participant.name)
    if (!key) continue
    exact.set(key, participant)
    const fallbackKey = accentlessNameKey(key)
    accentless.set(fallbackKey, accentless.has(fallbackKey) ? null : participant)
  }
  return (name: string): T | null => {
    const key = exactNameKey(name)
    return exact.get(key) ?? accentless.get(accentlessNameKey(key)) ?? null
  }
}
