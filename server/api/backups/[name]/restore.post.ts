import { getStorage } from '../../../utils/storage'

export default defineEventHandler((event) => {
  const name = getRouterParam(event, 'name')
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Falta el nombre del backup' })
  }

  try {
    const result = getStorage().restoreBackup(name)
    const storage = getStorage()
    return {
      ...result,
      health: storage.health(),
      backups: storage.listBackups()
    }
  } catch (caught) {
    const message = (caught as Error).message || 'No se pudo restaurar el backup'
    throw createError({
      statusCode: message === 'Backup no encontrado' ? 404 : 400,
      statusMessage: message
    })
  }
})
