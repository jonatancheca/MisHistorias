import { listAvailableNarrativeModels } from '../../../services/nsfw/modelCatalog.ts'
import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import { getStorage } from '../../../utils/storage.ts'

export default defineEventHandler(async (event) => {
  requireSessionUser(event)
  const settings = getStorage().readSettings()
  const baseUrl = typeof settings?.value.baseUrl === 'string' ? settings.value.baseUrl : ''
  const models = await listAvailableNarrativeModels(baseUrl)
  return { models }
})
