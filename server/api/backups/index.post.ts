import { getStorage } from '../../utils/storage'

export default defineEventHandler(() => {
  try {
    return getStorage().createManualBackup()
  } catch (caught) {
    throw createError({
      statusCode: 500,
      message: (caught as Error).message || 'No se pudo crear el backup'
    })
  }
})
