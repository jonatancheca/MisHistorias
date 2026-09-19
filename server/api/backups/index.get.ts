import { getStorage } from '../../utils/storage'
import { requireAccessAdmin } from '../../utils/access'

export default defineEventHandler(async (event) => {
  await requireAccessAdmin(event)
  return getStorage().listBackups()
})
