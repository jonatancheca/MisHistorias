import { requireAccessAdmin } from '../../utils/access'
import { getStorage } from '../../utils/storage'

export default defineEventHandler(async (event) => {
  await requireAccessAdmin(event)
  return { deleted: getStorage().clearErrorTraces() }
})
