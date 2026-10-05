import type { TokenLimit } from '../types/index.ts'

/** Margen para una respuesta cuando su máximo se calcula después de medir la entrada. */
export const AUTO_RESPONSE_RESERVE = 4096

export function responseTokenReserve(limit: TokenLimit) {
  return limit === 'auto' ? AUTO_RESPONSE_RESERVE : limit
}

export function resolveAutoResponseTokens(tokens: number, capacity: number) {
  if (!Number.isInteger(tokens) || tokens < 0 || !Number.isInteger(capacity) || capacity <= 0) {
    throw new Error('El modelo no devolvió una medición válida del contexto.')
  }
  const remaining = capacity - tokens
  if (remaining <= 0) throw new Error('El contexto enviado no deja espacio para la respuesta. Compacta el historial o reduce la entrada.')
  return remaining
}
