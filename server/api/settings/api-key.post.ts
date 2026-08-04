import { getStorage } from '../../utils/storage'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'cache-control', 'no-store, max-age=0')
  return { apiKey: getStorage().readSettings()?.apiKey ?? '' }
})
