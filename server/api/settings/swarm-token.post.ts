import { getStorage } from '../../utils/storage'
import { requireAccessAdmin } from '../../utils/access'

export default defineEventHandler((event) => {
  requireAccessAdmin(event)
  setResponseHeader(event, 'cache-control', 'no-store, max-age=0')
  return { swarmAuthToken: getStorage().readSettings()?.swarmAuthToken ?? '' }
})
