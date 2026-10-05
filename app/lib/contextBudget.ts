import type { ContextUsage } from '../../shared/types/index.ts'

export interface StoryContextMeasurement {
  characters: number
  tokens: number | null
  model: string
  tokenError?: string
  canCompact: boolean
}

export function tokenContextUsage(tokens: number, capacity: number, reservedTokens: number, configuredLimit: number, model: string): ContextUsage {
  if (!Number.isInteger(tokens) || tokens < 0 || !Number.isInteger(capacity) || capacity <= 0 ||
      !Number.isInteger(reservedTokens) || reservedTokens < 0) {
    throw new Error('El modelo no devolvió una medición válida del contexto.')
  }
  const available = capacity - reservedTokens
  if (available <= 0) {
    throw new Error('Los tokens máximos de respuesta ocupan toda la capacidad del modelo. Reduce ese ajuste o carga el modelo con más contexto.')
  }
  return {
    unit: 'tokens', count: tokens, configuredLimit,
    effectiveLimit: configuredLimit > 0 ? Math.min(configuredLimit, available) : available,
    capacity, reservedTokens, model
  }
}

export function contextFits(usage: ContextUsage) {
  return (usage.effectiveLimit === 0 || usage.count <= usage.effectiveLimit) &&
    (!usage.characters?.limit || usage.characters.count <= usage.characters.limit)
}

/** Identifica el límite excedido sin convertir caracteres a tokens. */
export function exceededContextLimit(usage: ContextUsage) {
  if (usage.characters?.limit && usage.characters.count > usage.characters.limit) {
    return { count: usage.characters.count, limit: usage.characters.limit, unit: 'caracteres' }
  }
  return { count: usage.count, limit: usage.effectiveLimit, unit: usage.unit === 'tokens' ? 'tokens' : 'caracteres' }
}

export class CompactionCapacityError extends Error {
  constructor() {
    super('El historial no cabe en una única petición de compactación. Puedes compactarlo por bloques para conservar todo su contenido.')
    this.name = 'CompactionCapacityError'
  }
}

/** Acumula resúmenes en memoria. El llamador valida y guarda un único checkpoint final. */
export async function summarizeInBlocks(options: {
  history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  previousSummary: string
  summarize: (previousSummary: string, history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => Promise<string>
  fits: (previousSummary: string, history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => Promise<boolean>
  signal: AbortSignal
}) {
  let summary = options.previousSummary
  const remaining = options.history.map(message => ({ ...message }))
  while (remaining.length) {
    options.signal.throwIfAborted()
    const block: typeof remaining = []
    while (remaining.length) {
      const next = remaining[0]!
      if (await options.fits(summary, [...block, next])) {
        block.push(remaining.shift()!)
        continue
      }
      if (block.length) break
      // Un mensaje individual también puede superar la capacidad. No se omite texto.
      const characters = Array.from(next.content)
      let low = 1
      let high = characters.length - 1
      let length = 0
      while (low <= high) {
        options.signal.throwIfAborted()
        const middle = Math.floor((low + high) / 2)
        if (await options.fits(summary, [{ ...next, content: characters.slice(0, middle).join('') }])) {
          length = middle
          low = middle + 1
        } else high = middle - 1
      }
      if (!length) throw new Error('El resumen acumulado y las instrucciones no dejan espacio para compactar el historial por bloques. Aumenta la capacidad del modelo o reduce los tokens máximos de respuesta.')
      block.push({ ...next, content: characters.slice(0, length).join('') })
      next.content = characters.slice(length).join('')
      break
    }
    summary = await options.summarize(summary, block)
  }
  // Un checkpoint sin historial posterior puede necesitar una nueva compactación.
  if (!options.history.length) summary = await options.summarize(summary, [])
  return summary
}
