import type { AppUpdateInfo } from '#shared/types'
import { fetchAppUpdate } from '../utils/appUpdate'
import { recordOperationalError } from '../utils/errorTraces'

const CACHE_MS = 15 * 60 * 1000
let cached: { expiresAt: number, value: AppUpdateInfo } | null = null

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const refresh = getQuery(event).refresh === '1'
  const now = Date.now()

  if (!refresh && cached && cached.expiresAt > now) return cached.value

  try {
    const value = await fetchAppUpdate({
      currentVersion: String(config.public.appVersion || 'dev'),
      currentCommit: String(config.public.appCommit || '')
    })
    cached = { expiresAt: now + CACHE_MS, value }
    return value
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    recordOperationalError(event, {
      source: 'update',
      operation: 'update.check',
      message: detail,
      status: 503,
      requestSent: null,
      request: {
        currentVersion: String(config.public.appVersion || 'dev'),
        currentCommit: String(config.public.appCommit || ''),
        refresh
      },
      response: error,
      stack: error instanceof Error ? error.stack : null
    })
    event.context.errorTraceRecorded = true
    throw createError({
      statusCode: 503,
      message: `No se pudo comprobar la actualización: ${detail}`
    })
  }
})
