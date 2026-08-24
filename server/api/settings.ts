import { getStorage } from '../utils/storage'

const ALLOWED_SETTINGS = new Set([
  'baseUrl',
  'apiKey',
  'privateLlmSettingsEnabled',
  'privateBaseUrl',
  'privateApiKey',
  'privateModel',
  'privateTemperature',
  'privateMaxTokens',
  'privateHistoryBudget',
  'swarmBaseUrl',
  'swarmAuthToken',
  'useChromeLlm',
  'privateUseChromeLlm',
  'model',
  'temperature',
  'maxTokens',
  'historyBudget',
  'activePresetId',
  'privateActivePresetId',
  'defaultPresetVersion',
  'privateDefaultPresetVersion',
  'defaultSoundVersion',
  'privateDefaultSoundVersion',
  'theme',
  'responseSpeed',
  'visualNovelManualAdvance',
  'mockMode',
  'userName',
  'privateUserName',
  'userColor',
  'protagonistPreferences',
  'privateProtagonistPreferences'
])

function validSetting(key: string, value: unknown) {
  switch (key) {
    case 'baseUrl':
    case 'swarmBaseUrl':
      return typeof value === 'string' && value.length <= 2048
    case 'privateBaseUrl':
      return value === null || (typeof value === 'string' && value.length <= 2048)
    case 'apiKey':
    case 'privateApiKey':
    case 'swarmAuthToken':
      return typeof value === 'string' && value.length <= 4096
    case 'privateLlmSettingsEnabled':
    case 'useChromeLlm':
      return typeof value === 'boolean'
    case 'privateUseChromeLlm':
      return value === null || typeof value === 'boolean'
    case 'model':
      return typeof value === 'string' && value.length <= 500
    case 'privateModel':
      return value === null || (typeof value === 'string' && value.length <= 500)
    case 'temperature':
      return typeof value === 'number' && value >= 0 && value <= 2
    case 'privateTemperature':
      return value === null || (typeof value === 'number' && value >= 0 && value <= 2)
    case 'maxTokens':
      return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 100000
    case 'privateMaxTokens':
      return value === null || (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 100000)
    case 'historyBudget':
      return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 1000000
    case 'privateHistoryBudget':
      return value === null || (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 1000000)
    case 'activePresetId':
    case 'privateActivePresetId':
      return value === null || typeof value === 'string'
    case 'defaultPresetVersion':
    case 'privateDefaultPresetVersion':
    case 'defaultSoundVersion':
    case 'privateDefaultSoundVersion':
      return Number.isInteger(value) && Number(value) >= 0
    case 'theme':
      return value === 'system' || value === 'light' || value === 'dark'
    case 'responseSpeed':
      return value === 'slow' || value === 'medium' || value === 'high' || value === 'instant'
    case 'visualNovelManualAdvance':
    case 'mockMode':
      return typeof value === 'boolean'
    case 'userName':
      return typeof value === 'string' && value.length <= 200
    case 'privateUserName':
      return value === null || (typeof value === 'string' && value.length <= 200)
    case 'userColor':
      return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    case 'protagonistPreferences':
      return typeof value === 'string' && value.length <= 100000
    case 'privateProtagonistPreferences':
      return value === null || (typeof value === 'string' && value.length <= 100000)
    default:
      return false
  }
}

function publicSettings(row: ReturnType<ReturnType<typeof getStorage>['readSettings']>) {
  if (!row) return null
  return {
    useChromeLlm: false,
    privateUseChromeLlm: null,
    ...row.value,
    apiKey: '',
    apiKeyConfigured: Boolean(row.apiKey),
    privateApiKey: '',
    privateApiKeyConfigured: Boolean(row.privateApiKey),
    swarmAuthToken: '',
    swarmAuthConfigured: Boolean(row.swarmAuthToken)
  }
}

export default defineEventHandler(async (event) => {
  const storage = getStorage()
  if (event.method === 'GET') return publicSettings(storage.readSettings())
  if (event.method !== 'PATCH') {
    throw createError({ statusCode: 405, message: 'Método no permitido' })
  }

  const rawBody = await readBody(event)
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    throw createError({ statusCode: 400, message: 'Ajustes no válidos' })
  }
  const entries = Object.entries(rawBody as Record<string, unknown>).filter(([key]) =>
    ALLOWED_SETTINGS.has(key)
  )
  if (entries.some(([key, value]) => !validSetting(key, value))) {
    throw createError({ statusCode: 400, message: 'Ajustes no válidos' })
  }
  const patch = Object.fromEntries(entries)
  return publicSettings(storage.writeSettings(patch))
})
