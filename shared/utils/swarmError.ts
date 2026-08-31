import type { StorySwarmError, SwarmCallDiagnostic } from '../types/index.ts'

const secretKey = /^(?:session_?id|swarm_token|(?:access_?|refresh_?|auth)?token|api[_-]?key|authorization|cookie|set-cookie|password|passwd|client_?secret|credentials?|headers)$/i

/** Nunca persistir credenciales, ni siquiera si el servidor las refleja en un error. */
export function sanitizeSwarmDiagnostic(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === 'string') {
    let text = value
      .replace(/data:image\/[^\s"']+/gi, '[imagen omitida]')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
      .replace(/((?:set-cookie|cookie|authorization)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\r\n<]+)/gi, '$1[REDACTED]')
      .replace(/((?:session_?id|swarm_token|authorization|api[_-]?key|password|cookie|(?:access_?|refresh_?|auth)?token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\r\n,;}<]+)/gi, '$1[REDACTED]')
    for (const secret of secrets.filter(Boolean)) {
      text = text.replaceAll(secret, '[REDACTED]').replaceAll(encodeURIComponent(secret), '[REDACTED]')
    }
    return text
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeSwarmDiagnostic(item, secrets))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !secretKey.test(key))
      .map(([key, item]) => [key, sanitizeSwarmDiagnostic(item, secrets)]))
  }
  return value
}

export function readSwarmDiagnostic(value: unknown): SwarmCallDiagnostic | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const item = value as Record<string, unknown>
  if ((item.target !== 'swarm' && item.target !== 'proxy') ||
      typeof item.operation !== 'string' || typeof item.message !== 'string' ||
      (item.requestSent !== null && typeof item.requestSent !== 'boolean') ||
      (item.request !== null && (!item.request || typeof item.request !== 'object' || Array.isArray(item.request)))) return
  const response = item.response as Record<string, unknown> | null
  if (response !== null && (!response || typeof response !== 'object' ||
      typeof response.status !== 'number' || !Number.isInteger(response.status))) return
  const generation = item.generation as Record<string, unknown> | undefined
  if (generation !== undefined && (!generation || typeof generation !== 'object' ||
      !generation.request || typeof generation.request !== 'object' || Array.isArray(generation.request) ||
      (generation.requestSent !== null && typeof generation.requestSent !== 'boolean'))) return
  return sanitizeSwarmDiagnostic({
    target: item.target,
    operation: item.operation,
    request: item.request,
    requestSent: item.requestSent,
    ...(generation ? { generation: { request: generation.request, requestSent: generation.requestSent } } : {}),
    response: response ? { status: response.status, body: response.body ?? null } : null,
    message: item.message
  }) as SwarmCallDiagnostic
}

export function readStorySwarmError(value: unknown): StorySwarmError | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const item = value as Record<string, unknown>
  const call = readSwarmDiagnostic(item.call)
  if (!call || typeof item.characterId !== 'string' || typeof item.characterName !== 'string' ||
      !Array.isArray(item.tags) || !item.tags.every((tag) => typeof tag === 'string')) return
  return { characterId: item.characterId, characterName: item.characterName, tags: item.tags, call }
}
