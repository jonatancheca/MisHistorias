import { getStorage } from '../../../utils/storage'
import { requireAccessAdmin } from '../../../utils/access'

export default defineEventHandler((event) => {
  const session = requireAccessAdmin(event)
  const name = getRouterParam(event, 'name')
  if (!name) {
    throw createError({ statusCode: 400, message: 'Falta el nombre del backup' })
  }

  try {
    const result = getStorage().restoreBackup(name)
    const storage = getStorage()
    if (!storage.readAccessState().multiUserEnabled && session.identity) {
      storage.activateMultiUser(session.identity)
    }
    return {
      ...result,
      health: storage.health(),
      backups: storage.listBackups()
    }
  } catch (caught) {
    const message = (caught as Error).message || 'No se pudo restaurar el backup'
    throw createError({
      statusCode: message === 'Backup no encontrado' ? 404 : 400,
      message
    })
  }
})
