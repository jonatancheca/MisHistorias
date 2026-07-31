const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
  /\.local$/i,
  /^host\.docker\.internal$/i
]

/**
 * El proxy solo puede alcanzar el LMStudio del propio usuario: se limita a hosts
 * locales/privados para no convertirlo en un SSRF abierto.
 */
export function assertLocalBaseUrl(rawBaseUrl: unknown): string {
  if (typeof rawBaseUrl !== 'string' || rawBaseUrl.trim() === '') {
    throw createError({ statusCode: 400, statusMessage: 'Falta la URL del modelo' })
  }
  let url: URL
  try {
    url = new URL(rawBaseUrl.trim())
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'URL del modelo no válida' })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw createError({ statusCode: 400, statusMessage: 'La URL debe usar http o https' })
  }
  const host = url.hostname
  if (!PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Solo se permiten servidores locales o de red privada'
    })
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/**
 * Cabecera Bearer opcional para servidores con token. Se limpian saltos de línea
 * para evitar inyección de cabeceras.
 */
export function authHeader(rawApiKey: unknown): Record<string, string> {
  if (typeof rawApiKey !== 'string') return {}
  const token = rawApiKey.replace(/[\r\n]/g, '').trim()
  return token ? { authorization: `Bearer ${token}` } : {}
}
