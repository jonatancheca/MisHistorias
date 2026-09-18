import { requireAccessIdentity } from '../../utils/access.ts'
import { getStorage } from '../../utils/storage.ts'

export default defineEventHandler(async (event) => {
  const identity = requireAccessIdentity(event)
  const body = await readBody(event) as { email?: unknown } | null
  if (body?.email !== identity.email) {
    throw createError({ statusCode: 400, statusMessage: 'La confirmación no coincide con el usuario' })
  }
  const storage = getStorage()
  if (storage.readAccessState().multiUserEnabled) {
    throw createError({ statusCode: 409, statusMessage: 'El modo multiusuario ya está activo' })
  }
  const result = storage.activateMultiUser(identity)
  return {
    multiUserEnabled: result.state.multiUserEnabled,
    identity,
    isAdmin: true,
    canActivate: false,
    claimed: result.claimed
  }
})
