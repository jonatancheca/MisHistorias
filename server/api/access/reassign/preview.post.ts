import { requireIdentityReassignmentAccess } from '../../../utils/access.ts'
import {
  identityReassignmentRequest,
  mapIdentityReassignmentError
} from '../../../utils/identityReassignment.ts'
import { getStorage } from '../../../utils/storage.ts'

export default defineEventHandler(async (event) => {
  try {
    const request = identityReassignmentRequest(await readBody(event))
    await requireIdentityReassignmentAccess(event, request)
    return getStorage().previewIdentityReassignment(request)
  } catch (caught) {
    mapIdentityReassignmentError(caught)
  }
})
