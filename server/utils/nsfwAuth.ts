import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import type {
  NsfwAuthStatus,
  NsfwCreateUserInput,
  NsfwPublicUser,
  NsfwSessionUser,
  NsfwUpdateUserInput,
  NsfwUserRole
} from '../../shared/types/nsfw/auth.ts'
import { getStorage } from './storage.ts'

export const NSFW_SESSION_COOKIE = 'mh_nsfw_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64

interface UserRow {
  id: string
  username: string
  password_hash: string
  role: NsfwUserRole
  active: number
  avatar_asset_id: string | null
  created_at: number
  updated_at: number
  last_login_at: number | null
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function integer(value: unknown, fallback = 0) {
  return Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback
}

function normalizeUsername(value: string) {
  return value.trim()
}

function validateUsername(value: string) {
  const username = normalizeUsername(value)
  if (username.length < 2 || username.length > 80) {
    throw createError({ statusCode: 400, statusMessage: 'Nombre de usuario no válido' })
  }
  const localName = /^[\p{L}\p{N}._-]+$/u.test(username)
  const email = /^[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}$/u.test(username)
  if (!localName && !email) {
    throw createError({ statusCode: 400, statusMessage: 'Nombre de usuario no válido' })
  }
  return username
}

function validatePassword(value: string) {
  const password = value.trim()
  if (password.length < 8 || password.length > 128) {
    throw createError({ statusCode: 400, statusMessage: 'Contraseña no válida' })
  }
  return password
}

export function hashPassword(password: string) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  })
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

export function verifyPassword(password: string, encoded: string) {
  const parts = encoded.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = Buffer.from(parts[1] ?? '', 'hex')
  const expected = Buffer.from(parts[2] ?? '', 'hex')
  if (!salt.length || !expected.length) return false
  const actual = scryptSync(password, salt, expected.length, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  })
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function rowToPublicUser(row: UserRow): NsfwPublicUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    active: Boolean(row.active),
    avatarAssetId: row.avatar_asset_id,
    createdAt: integer(row.created_at),
    updatedAt: integer(row.updated_at),
    lastLoginAt: row.last_login_at === null ? null : integer(row.last_login_at)
  }
}

function rowToSessionUser(row: UserRow): NsfwSessionUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role
  }
}

function database() {
  return getStorage().database
}

export function countNsfwUsers() {
  const row = database().prepare('SELECT COUNT(*) AS total FROM nsfw_users').get() as {
    total: number
  }
  return integer(row.total)
}

const OWNER_ADMIN_USERNAME = 'bernatmv@gmail.com'

export function ensureOwnerAdmin() {
  if (process.env.PLAYWRIGHT_TEST === '1') return null
  const username = normalizeUsername(process.env.NSFW_OWNER_USERNAME || OWNER_ADMIN_USERNAME)
  const password = (process.env.NSFW_OWNER_PASSWORD || 'Pollux3435').trim()
  if (!username || password.length < 8) return null

  const existing = database()
    .prepare('SELECT * FROM nsfw_users WHERE username = ? COLLATE NOCASE')
    .get(username) as UserRow | undefined

  if (!existing) {
    return createUser({ username, password, role: 'admin' })
  }

  if (existing.role !== 'admin' || !existing.active) {
    return updateUser(existing.id, { role: 'admin', active: true })
  }
  return rowToPublicUser(existing)
}

export function getAuthStatus(event: H3Event): NsfwAuthStatus {
  ensureOwnerAdmin()
  const user = resolveSessionUser(event)
  if (user) return { mode: 'session', user }
  if (countNsfwUsers() === 0) return { mode: 'bootstrap', user: null }
  return { mode: 'login', user: null }
}

export function resolveSessionUser(event: H3Event): NsfwSessionUser | null {
  const token = getCookie(event, NSFW_SESSION_COOKIE)
  if (!token) return null

  const row = database()
    .prepare(`
      SELECT u.*
      FROM nsfw_sessions s
      JOIN nsfw_users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `)
    .get(hashToken(token), Date.now()) as UserRow | undefined

  if (!row || !row.active) return null
  return rowToSessionUser(row)
}

export function requireSessionUser(event: H3Event): NsfwSessionUser {
  const user = resolveSessionUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Sesión no válida' })
  }
  return user
}

export function requireAdminUser(event: H3Event): NsfwSessionUser {
  const user = requireSessionUser(event)
  if (user.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Se requiere administrador' })
  }
  return user
}

function createSession(userId: string) {
  const now = Date.now()
  const token = randomUUID()
  const id = randomUUID()
  database()
    .prepare(`
      INSERT INTO nsfw_sessions(id, user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(id, userId, hashToken(token), now + SESSION_TTL_MS, now)
  database()
    .prepare('UPDATE nsfw_users SET last_login_at = ?, updated_at = ? WHERE id = ?')
    .run(now, now, userId)
  return token
}

export function setSessionCookie(event: H3Event, token: string) {
  setCookie(event, NSFW_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000)
  })
}

export function clearSessionCookie(event: H3Event) {
  deleteCookie(event, NSFW_SESSION_COOKIE, { path: '/' })
}

export function bootstrapAdmin(event: H3Event, usernameInput: string, passwordInput: string) {
  ensureOwnerAdmin()
  if (countNsfwUsers() > 0) {
    throw createError({ statusCode: 409, statusMessage: 'Ya existen usuarios' })
  }
  const username = validateUsername(usernameInput)
  const password = validatePassword(passwordInput)
  const now = Date.now()
  const id = randomUUID()
  database()
    .prepare(`
      INSERT INTO nsfw_users(
        id, username, password_hash, role, active, avatar_asset_id,
        created_at, updated_at, last_login_at
      ) VALUES (?, ?, ?, 'admin', 1, NULL, ?, ?, NULL)
    `)
    .run(id, username, hashPassword(password), now, now)
  const token = createSession(id)
  setSessionCookie(event, token)
  const row = database()
    .prepare('SELECT * FROM nsfw_users WHERE id = ?')
    .get(id) as UserRow
  return rowToSessionUser(row)
}

export function loginUser(event: H3Event, usernameInput: string, passwordInput: string) {
  ensureOwnerAdmin()
  const username = normalizeUsername(usernameInput)
  const password = passwordInput
  const row = database()
    .prepare('SELECT * FROM nsfw_users WHERE username = ? COLLATE NOCASE')
    .get(username) as UserRow | undefined
  if (!row || !row.active || !verifyPassword(password, row.password_hash)) {
    throw createError({ statusCode: 401, statusMessage: 'Credenciales no válidas' })
  }
  const token = createSession(row.id)
  setSessionCookie(event, token)
  return rowToSessionUser(row)
}

export function logoutUser(event: H3Event) {
  const token = getCookie(event, NSFW_SESSION_COOKIE)
  if (token) {
    database()
      .prepare('DELETE FROM nsfw_sessions WHERE token_hash = ?')
      .run(hashToken(token))
  }
  clearSessionCookie(event)
}

export function listUsers(): NsfwPublicUser[] {
  const rows = database()
    .prepare(`
      SELECT * FROM nsfw_users
      ORDER BY username COLLATE NOCASE ASC
    `)
    .all() as UserRow[]
  return rows.map(rowToPublicUser)
}

function countActiveAdmins(excludeUserId?: string) {
  const rows = database()
    .prepare(`
      SELECT id FROM nsfw_users
      WHERE role = 'admin' AND active = 1
    `)
    .all() as Array<{ id: string }>
  return rows.filter((row) => row.id !== excludeUserId).length
}

export function createUser(input: NsfwCreateUserInput): NsfwPublicUser {
  const username = validateUsername(input.username)
  const password = validatePassword(input.password)
  const role = input.role === 'admin' ? 'admin' : 'user'
  const now = Date.now()
  const id = randomUUID()
  try {
    database()
      .prepare(`
        INSERT INTO nsfw_users(
          id, username, password_hash, role, active, avatar_asset_id,
          created_at, updated_at, last_login_at
        ) VALUES (?, ?, ?, ?, 1, NULL, ?, ?, NULL)
      `)
      .run(id, username, hashPassword(password), role, now, now)
  } catch (caught) {
    if (caught instanceof Error && caught.message.includes('UNIQUE')) {
      throw createError({ statusCode: 409, statusMessage: 'Nombre de usuario en uso' })
    }
    throw caught
  }
  const row = database()
    .prepare('SELECT * FROM nsfw_users WHERE id = ?')
    .get(id) as UserRow
  return rowToPublicUser(row)
}

export function updateUser(userId: string, input: NsfwUpdateUserInput): NsfwPublicUser {
  const row = database()
    .prepare('SELECT * FROM nsfw_users WHERE id = ?')
    .get(userId) as UserRow | undefined
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Usuario no encontrado' })
  }

  const nextRole = input.role === 'admin' || input.role === 'user' ? input.role : row.role
  const nextActive = typeof input.active === 'boolean' ? input.active : Boolean(row.active)
  const nextUsername =
    typeof input.username === 'string' ? validateUsername(input.username) : row.username

  if (row.role === 'admin' && nextRole !== 'admin' && countActiveAdmins(row.id) === 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Debe quedar al menos un administrador activo'
    })
  }
  if (row.role === 'admin' && !nextActive && countActiveAdmins(row.id) === 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Debe quedar al menos un administrador activo'
    })
  }

  const now = Date.now()
  const passwordHash =
    typeof input.password === 'string' ? hashPassword(validatePassword(input.password)) : row.password_hash

  try {
    database()
      .prepare(`
        UPDATE nsfw_users
        SET username = ?, password_hash = ?, role = ?, active = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        nextUsername,
        passwordHash,
        nextRole,
        nextActive ? 1 : 0,
        now,
        userId
      )
  } catch (caught) {
    if (caught instanceof Error && caught.message.includes('UNIQUE')) {
      throw createError({ statusCode: 409, statusMessage: 'Nombre de usuario en uso' })
    }
    throw caught
  }

  if (!nextActive) {
    database().prepare('DELETE FROM nsfw_sessions WHERE user_id = ?').run(userId)
  }

  const updated = database()
    .prepare('SELECT * FROM nsfw_users WHERE id = ?')
    .get(userId) as UserRow
  return rowToPublicUser(updated)
}

export function readCredentials(body: unknown) {
  const value = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const record = value as Record<string, unknown>
  return {
    username: text(record.username),
    password: text(record.password)
  }
}

export function readCreateUserInput(body: unknown): NsfwCreateUserInput {
  const value = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const record = value as Record<string, unknown>
  return {
    username: text(record.username),
    password: text(record.password),
    role: record.role === 'admin' ? 'admin' : 'user'
  }
}

export function readUpdateUserInput(body: unknown): NsfwUpdateUserInput {
  const value = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const record = value as Record<string, unknown>
  const patch: NsfwUpdateUserInput = {}
  if (typeof record.username === 'string') patch.username = record.username
  if (record.role === 'admin' || record.role === 'user') patch.role = record.role
  if (typeof record.password === 'string' && record.password.trim()) patch.password = record.password
  if (typeof record.active === 'boolean') patch.active = record.active
  return patch
}
