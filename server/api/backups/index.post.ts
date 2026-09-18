import { getStorage } from '../../utils/storage'
import { requireAccessAdmin } from '../../utils/access'

export default defineEventHandler((event) => {
  requireAccessAdmin(event)
  try {
    return getStorage().createManualBackup()
  } catch (caught) {
    throw createError({
      statusCode: 500,
      message: (caught as Error).message || 'No se pudo crear el backup'
    })
  }
})
