import { createReadStream } from 'node:fs'
import { getStorage } from '../../utils/storage'
import { requireAccessAdmin } from '../../utils/access'

function asciiFilename(name: string) {
  return name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
}

export default defineEventHandler(async (event) => {
  await requireAccessAdmin(event)
  const name = getRouterParam(event, 'name')
  if (!name) {
    throw createError({ statusCode: 400, message: 'Falta el nombre del backup' })
  }

  try {
    const { backup, path } = getStorage().getBackupFile(name)
    const encodedName = encodeURIComponent(backup.name)
    setHeader(event, 'Content-Type', 'application/vnd.sqlite3')
    setHeader(event, 'Content-Length', backup.size)
    setHeader(
      event,
      'Content-Disposition',
      `attachment; filename="${asciiFilename(backup.name)}"; filename*=UTF-8''${encodedName}`
    )
    setHeader(event, 'Cache-Control', 'private, no-store')
    return sendStream(event, createReadStream(path))
  } catch (caught) {
    const message = (caught as Error).message || 'No se pudo descargar el backup'
    throw createError({
      statusCode: message === 'Backup no encontrado' ? 404 : 500,
      message
    })
  }
})
