import { getStorage } from '../../utils/storage'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'cache-control', 'no-store, max-age=0')
  const settings = getStorage().readSettings()
  const privateScope = getQuery(event).scope === 'private'
  return {
    apiKey:
      privateScope && settings?.value.privateLlmSettingsEnabled === true
        ? settings.privateApiKey
        : settings?.apiKey ?? ''
  }
})
