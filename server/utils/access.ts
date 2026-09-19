import { createError, getHeader, type H3Event } from 'h3'
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload
} from 'jose'
import type {
  AccessConfiguration,
  AccessIdentity,
  AccessSession,
  IdentityReassignmentRequest
} from '../../shared/types/index.ts'
import type { DataScope, StorageAccess, StoredAccessState } from './storage.ts'
import { getStorage } from './storage.ts'

const ACCESS_SESSION_CONTEXT_KEY = 'misHistoriasAccessSession'
const remoteKeySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function accessError(statusCode: number, message: string) {
  return createError({ statusCode, message })
}

export function parseAccessConfiguration(value: unknown): AccessConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw accessError(400, 'Configuración de Cloudflare Access no válida')
  }
  const candidate = value as Partial<AccessConfiguration>
  const audience = typeof candidate.audience === 'string' ? candidate.audience.trim() : ''
  let teamDomain: URL
  try {
    teamDomain = new URL(typeof candidate.teamDomain === 'string' ? candidate.teamDomain.trim() : '')
  } catch {
    throw accessError(400, 'El dominio del equipo de Cloudflare Access no es válido')
  }
  if (
    teamDomain.protocol !== 'https:' ||
    teamDomain.username ||
    teamDomain.password ||
    teamDomain.port ||
    teamDomain.pathname !== '/' ||
    teamDomain.search ||
    teamDomain.hash ||
    !teamDomain.hostname.endsWith('.cloudflareaccess.com')
  ) {
    throw accessError(400, 'El dominio debe ser un origen HTTPS de cloudflareaccess.com')
  }
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(audience)) {
    throw accessError(400, 'El audience de Cloudflare Access no es válido')
  }
  return { teamDomain: teamDomain.origin, audience }
}

export function storedAccessConfiguration(): AccessConfiguration | null {
  const settings = getStorage().readSettings()?.value
  if (!settings) return null
  const teamDomain = typeof settings.accessTeamDomain === 'string' ? settings.accessTeamDomain : ''
  const audience = typeof settings.accessAudience === 'string' ? settings.accessAudience : ''
  if (!teamDomain || !audience) return null
  try {
    return parseAccessConfiguration({ teamDomain, audience })
  } catch {
    return null
  }
}

function remoteKeySet(configuration: AccessConfiguration) {
  let keySet = remoteKeySets.get(configuration.teamDomain)
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`${configuration.teamDomain}/cdn-cgi/access/certs`))
    remoteKeySets.set(configuration.teamDomain, keySet)
  }
  return keySet
}

function identityFromPayload(payload: JWTPayload): AccessIdentity | null {
  return payload.type === 'app' &&
    typeof payload.sub === 'string' && payload.sub.trim() &&
    typeof payload.email === 'string' && payload.email.trim() &&
    typeof payload.exp === 'number'
    ? { id: payload.sub, email: payload.email }
    : null
}

export async function verifyAccessIdentity(
  token: string,
  configuration: AccessConfiguration,
  options: { key?: JWTVerifyGetKey, now?: Date } = {}
): Promise<AccessIdentity | null> {
  try {
    const result = await jwtVerify(token, options.key ?? remoteKeySet(configuration), {
      algorithms: ['RS256'],
      issuer: configuration.teamDomain,
      audience: configuration.audience,
      currentDate: options.now
    })
    return identityFromPayload(result.payload)
  } catch {
    return null
  }
}

function readDevelopmentIdentity(): AccessIdentity | null {
  if (process.env.NODE_ENV === 'production') return null
  const id = process.env.MISHISTORIAS_DEV_ACCESS_SUB?.trim()
  const email = process.env.MISHISTORIAS_DEV_ACCESS_EMAIL?.trim()
  return id && email ? { id, email } : null
}

export async function readAccessIdentity(
  event: H3Event,
  configuration = storedAccessConfiguration()
): Promise<AccessIdentity | null> {
  const token = getHeader(event, 'cf-access-jwt-assertion')?.trim()
  if (!token) return readDevelopmentIdentity()
  return configuration ? verifyAccessIdentity(token, configuration) : null
}

export function accessSessionFromEvent(event: H3Event): AccessSession | null {
  const context = event.context as Record<string, unknown>
  return (context[ACCESS_SESSION_CONTEXT_KEY] as AccessSession | undefined) ?? null
}

function cacheAccessSession(event: H3Event, session: AccessSession) {
  const context = event.context as Record<string, unknown>
  context[ACCESS_SESSION_CONTEXT_KEY] = session
  return session
}

export async function readAccessSession(event: H3Event, allowMissingIdentity = false): Promise<AccessSession> {
  const cached = accessSessionFromEvent(event)
  if (cached) {
    if (cached.multiUserEnabled && !cached.identity && !allowMissingIdentity) {
      throw accessError(401, 'Identidad de Cloudflare Access requerida')
    }
    return cached
  }
  const storage = getStorage()
  const state = storage.readAccessState()
  const configuration = storedAccessConfiguration()
  if (state.multiUserEnabled && !configuration) {
    throw accessError(503, 'La configuración de Cloudflare Access no está disponible')
  }
  const token = getHeader(event, 'cf-access-jwt-assertion')?.trim()
  const identity = await readAccessIdentity(event, configuration)
  if (state.multiUserEnabled && token && !identity) {
    throw accessError(401, 'Token de Cloudflare Access no válido')
  }
  if (state.multiUserEnabled && !identity && !allowMissingIdentity) {
    throw accessError(401, 'Identidad de Cloudflare Access requerida')
  }
  if (identity) storage.rememberAccessIdentity(identity)
  return cacheAccessSession(event, {
    multiUserEnabled: state.multiUserEnabled,
    identity,
    isAdmin: Boolean(identity && state.adminOwnerId === identity.id),
    canActivate: !state.multiUserEnabled && Boolean(token || identity)
  })
}

export async function requireAccessIdentity(
  event: H3Event,
  configuration = storedAccessConfiguration()
) {
  const identity = await readAccessIdentity(event, configuration)
  if (!identity) {
    throw accessError(401, 'Identidad de Cloudflare Access requerida')
  }
  return identity
}

export async function requireAccessAdmin(event: H3Event) {
  const session = await readAccessSession(event)
  if (session.multiUserEnabled && !session.isAdmin) {
    throw accessError(403, 'Operación reservada al administrador')
  }
  return session
}

export function canRecoverAdministrator(
  state: StoredAccessState,
  identity: AccessIdentity,
  request: IdentityReassignmentRequest
) {
  const sameEmail = (left: string | null, right: string) =>
    Boolean(left && left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0)
  return request.source.id === state.adminOwnerId &&
    sameEmail(state.adminEmail, request.source.email) &&
    request.destination.id === identity.id &&
    sameEmail(identity.email, request.destination.email) &&
    sameEmail(state.adminEmail, identity.email)
}

export async function requireIdentityReassignmentAccess(
  event: H3Event,
  request: IdentityReassignmentRequest
) {
  const session = await readAccessSession(event)
  if (!session.multiUserEnabled || !session.identity) {
    throw createError({ statusCode: 409, statusMessage: 'El modo multiusuario no está activo' })
  }
  if (session.isAdmin) return session

  const state = getStorage().readAccessState()
  if (!canRecoverAdministrator(state, session.identity, request)) {
    throw createError({ statusCode: 403, statusMessage: 'Operación reservada al administrador' })
  }
  return session
}

export async function storageAccessFor(event: H3Event, scope: DataScope): Promise<StorageAccess> {
  const session = await readAccessSession(event)
  return {
    ownerId: session.multiUserEnabled ? session.identity!.id : null,
    includeSharedDemo: session.multiUserEnabled && scope === 'private'
  }
}
