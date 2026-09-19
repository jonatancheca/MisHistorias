import { requireIdentityReassignmentAccess } from '../../utils/access.ts'
import {
  identityReassignmentRequest,
  mapIdentityReassignmentError
} from '../../utils/identityReassignment.ts'
import { getStorage } from '../../utils/storage.ts'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event) as Record<string, unknown> | null
    const request = identityReassignmentRequest(body)
    const fingerprint = typeof body?.fingerprint === 'string' ? body.fingerprint : ''
    if (!fingerprint) {
      throw createError({ statusCode: 400, statusMessage: 'Falta la previsualización confirmada' })
    }
    const session = await requireIdentityReassignmentAccess(event, request)
    return getStorage().reassignIdentity(request, session.identity!, fingerprint)
  } catch (caught) {
    mapIdentityReassignmentError(caught)
  }
})
