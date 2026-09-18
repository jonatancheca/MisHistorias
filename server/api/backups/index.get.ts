import { getStorage } from '../../utils/storage'
import { requireAccessAdmin } from '../../utils/access'

export default defineEventHandler((event) => {
  requireAccessAdmin(event)
  return getStorage().listBackups()
})
