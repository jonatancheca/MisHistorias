import { requireAccessAdmin } from '../../utils/access'
import { getStorage } from '../../utils/storage'

export default defineEventHandler((event) => {
  requireAccessAdmin(event)
  return { deleted: getStorage().clearErrorTraces() }
})
