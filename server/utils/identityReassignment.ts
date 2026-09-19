import { createError } from 'h3'
import type { AccessIdentity, IdentityReassignmentRequest } from '../../shared/types/index.ts'

function identity(value: unknown): AccessIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
  const email = typeof candidate.email === 'string' ? candidate.email.trim() : ''
  if (!id || id.length > 512 || !email || email.length > 320 || !email.includes('@')) return null
  return { id, email }
}

export function identityReassignmentRequest(value: unknown): IdentityReassignmentRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage: 'Datos de reasignación no válidos' })
  }
  const candidate = value as Record<string, unknown>
  const source = identity(candidate.source)
  const destination = identity(candidate.destination)
  if (!source || !destination) {
    throw createError({ statusCode: 400, statusMessage: 'Sub y email válidos son obligatorios' })
  }
  return { source, destination }
}

export function mapIdentityReassignmentError(caught: unknown): never {
  if (caught && typeof caught === 'object' && 'statusCode' in caught) throw caught
  const error = caught as { code?: string; message?: string }
  const clientErrors = new Set([
    'ERR_IDENTITY_INVALID',
    'ERR_IDENTITY_SAME',
    'ERR_IDENTITY_EMAIL_MISMATCH'
  ])
  const conflictErrors = new Set([
    'ERR_IDENTITY_DESTINATION_UNKNOWN',
    'ERR_IDENTITY_DESTINATION_CONFLICT',
    'ERR_IDENTITY_PREVIEW_STALE'
  ])
  if (clientErrors.has(error.code ?? '')) {
    throw createError({ statusCode: 400, statusMessage: error.message })
  }
  if (error.code === 'ERR_IDENTITY_SOURCE_EMPTY') {
    throw createError({ statusCode: 404, statusMessage: error.message })
  }
  if (conflictErrors.has(error.code ?? '')) {
    throw createError({ statusCode: 409, statusMessage: error.message })
  }
  console.error('SQLite identity reassignment error', error)
  throw createError({ statusCode: 500, statusMessage: 'No se pudo reasignar la identidad' })
}
