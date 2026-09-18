import { Buffer } from 'node:buffer'
import { createError, getHeader, type H3Event } from 'h3'
import type { AccessIdentity, AccessSession } from '../../shared/types/index.ts'
import type { DataScope, StorageAccess } from './storage.ts'
import { getStorage } from './storage.ts'

interface AccessTokenPayload {
  sub?: unknown
  email?: unknown
  type?: unknown
  exp?: unknown
  nbf?: unknown
}

function readJwtPayload(token: string): AccessTokenPayload | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return decoded && typeof decoded === 'object' && !Array.isArray(decoded)
      ? decoded as AccessTokenPayload
      : null
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

export function decodeAccessIdentity(token: string, now = Math.floor(Date.now() / 1000)): AccessIdentity | null {
  const payload = readJwtPayload(token)
  if (
    !payload ||
    payload.type !== 'app' ||
    typeof payload.sub !== 'string' ||
    !payload.sub.trim() ||
    typeof payload.email !== 'string' ||
    !payload.email.trim() ||
    (typeof payload.exp === 'number' && payload.exp <= now) ||
    (typeof payload.nbf === 'number' && payload.nbf > now)
  ) {
    return null
  }
  return { id: payload.sub, email: payload.email }
}

export function readAccessIdentity(event: H3Event): AccessIdentity | null {
  const token = getHeader(event, 'cf-access-jwt-assertion')?.trim()
  return token ? decodeAccessIdentity(token) : readDevelopmentIdentity()
}

export function readAccessSession(event: H3Event, allowMissingIdentity = false): AccessSession {
  const state = getStorage().readAccessState()
  const identity = readAccessIdentity(event)
  if (state.multiUserEnabled && !identity && !allowMissingIdentity) {
    throw createError({ statusCode: 401, statusMessage: 'Identidad de Cloudflare Access requerida' })
  }
  return {
    multiUserEnabled: state.multiUserEnabled,
    identity,
    isAdmin: Boolean(identity && state.adminOwnerId === identity.id),
    canActivate: !state.multiUserEnabled && Boolean(identity)
  }
}

export function requireAccessIdentity(event: H3Event) {
  const identity = readAccessIdentity(event)
  if (!identity) {
    throw createError({ statusCode: 401, statusMessage: 'Identidad de Cloudflare Access requerida' })
  }
  return identity
}

export function requireAccessAdmin(event: H3Event) {
  const session = readAccessSession(event)
  if (session.multiUserEnabled && !session.isAdmin) {
    throw createError({ statusCode: 403, statusMessage: 'Operación reservada al administrador' })
  }
  return session
}

export function storageAccessFor(event: H3Event, scope: DataScope): StorageAccess {
  const session = readAccessSession(event)
  return {
    ownerId: session.multiUserEnabled ? session.identity!.id : null,
    includeSharedDemo: session.multiUserEnabled && scope === 'private'
  }
}
