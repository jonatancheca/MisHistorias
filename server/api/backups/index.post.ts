import { getStorage } from '../../utils/storage'
import { requireAccessAdmin } from '../../utils/access'
import { recordOperationalError } from '../../utils/errorTraces'

export default defineEventHandler(async (event) => {
  await requireAccessAdmin(event)
  try {
    return getStorage().createManualBackup()
  } catch (caught) {
    const error = caught as Error
    recordOperationalError(event, {
      source: 'backup',
      operation: 'backup.create',
      message: error.message || 'No se pudo crear el backup',
      status: 500,
      requestSent: false,
      request: { type: 'manual' },
      response: error,
      stack: error.stack
    })
    event.context.errorTraceRecorded = true
    throw createError({
      statusCode: 500,
      message: error.message || 'No se pudo crear el backup'
    })
  }
})
