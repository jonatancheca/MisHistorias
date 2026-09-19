import { createWriteStream, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { getStorage } from '../../utils/storage'
import { requireAccessAdmin } from '../../utils/access'

function uploadedName(event: Parameters<typeof getHeader>[0]) {
  const encodedName = getHeader(event, 'x-backup-name')
  if (!encodedName) throw new Error('Falta el nombre del backup')

  try {
    return decodeURIComponent(encodedName)
  } catch {
    throw new Error('El nombre del backup no es válido')
  }
}

export default defineEventHandler(async (event) => {
  await requireAccessAdmin(event)
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-backup-upload-'))
  const uploadPath = join(directory, 'upload.sqlite')

  try {
    const name = uploadedName(event)
    await pipeline(event.node.req, createWriteStream(uploadPath, { flags: 'wx' }))
    return getStorage().importBackup(uploadPath, name)
  } catch (caught) {
    throw createError({
      statusCode: 400,
      message: (caught as Error).message || 'No se pudo subir el backup'
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
