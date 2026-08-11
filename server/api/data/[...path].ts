import type { H3Event } from 'h3'
import type { DataResource, DataScope } from '../../utils/storage'
import { getStorage } from '../../utils/storage'

const RESOURCES = new Set<DataResource>([
  'characters',
  'images',
  'backgrounds',
  'stories',
  'messages',
  'llmDebugTraces',
  'presets'
])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

function asScope(value: unknown): DataScope {
  if (value === 'normal' || value === 'private') return value
  throw createError({ statusCode: 400, statusMessage: 'Ámbito de datos no válido' })
}

function asResource(value: unknown): DataResource {
  if (typeof value === 'string' && RESOURCES.has(value as DataResource)) {
    return value as DataResource
  }
  throw createError({ statusCode: 404, statusMessage: 'Recurso no encontrado' })
}

function asId(value: unknown) {
  if (typeof value === 'string' && value.trim() && value.length <= 200) return value
  throw createError({ statusCode: 400, statusMessage: 'Falta el identificador' })
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  throw createError({ statusCode: 400, statusMessage: 'Datos no válidos' })
}

function hasString(value: Record<string, unknown>, key: string) {
  return typeof value[key] === 'string'
}

function hasNumber(value: Record<string, unknown>, key: string) {
  return Number.isFinite(value[key])
}

function hasStringArray(value: Record<string, unknown>, key: string) {
  return Array.isArray(value[key]) && value[key].every((item) => typeof item === 'string')
}

function hasCharacterCustomizations(value: Record<string, unknown>) {
  return (
    Array.isArray(value.characterCustomizations) &&
    value.characterCustomizations.every((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false
      const customization = item as Record<string, unknown>
      return (
        typeof customization.characterId === 'string' &&
        typeof customization.prompt === 'string' &&
        Array.isArray(customization.tags) &&
        customization.tags.every((tag) => typeof tag === 'string')
      )
    })
  )
}

function validatePayload(resource: DataResource, rawValue: unknown) {
  const value = asRecord(rawValue)
  let valid = false
  switch (resource) {
    case 'characters':
      valid =
        hasString(value, 'name') &&
        hasString(value, 'prompt') &&
        hasStringArray(value, 'tags') &&
        hasString(value, 'color') &&
        hasNumber(value, 'createdAt') &&
        hasNumber(value, 'updatedAt')
      break
    case 'stories':
      valid =
        hasString(value, 'title') &&
        hasString(value, 'premise') &&
        typeof value.visualMode === 'boolean' &&
        hasString(value, 'protagonistPreferences') &&
        (value.protagonistPreferencesMode === 'append' ||
          value.protagonistPreferencesMode === 'replace') &&
        hasStringArray(value, 'characterIds') &&
        hasCharacterCustomizations(value) &&
        (value.initialBackgroundId === null || typeof value.initialBackgroundId === 'string') &&
        (value.presetId === null || typeof value.presetId === 'string') &&
        (value.imageCatalogSnapshot === undefined || Array.isArray(value.imageCatalogSnapshot)) &&
        hasNumber(value, 'createdAt') &&
        hasNumber(value, 'updatedAt')
      break
    case 'messages':
      valid =
        hasString(value, 'storyId') &&
        (value.role === 'user' || value.role === 'assistant') &&
        hasString(value, 'raw') &&
        Array.isArray(value.segments) &&
        hasNumber(value, 'createdAt')
      break
    case 'llmDebugTraces':
      valid =
        hasString(value, 'storyId') &&
        (value.requestMessageId === undefined || typeof value.requestMessageId === 'string') &&
        (value.responseMessageId === undefined || typeof value.responseMessageId === 'string') &&
        (value.status === 'success' || value.status === 'error') &&
        Boolean(value.request) &&
        typeof value.request === 'object' &&
        !Array.isArray(value.request) &&
        Boolean(value.response) &&
        typeof value.response === 'object' &&
        !Array.isArray(value.response) &&
        hasNumber(value, 'createdAt')
      break
    case 'presets':
      valid =
        hasString(value, 'name') &&
        hasString(value, 'content') &&
        hasNumber(value, 'createdAt') &&
        hasNumber(value, 'updatedAt')
      break
    case 'images':
      valid =
        hasString(value, 'characterId') &&
        hasStringArray(value, 'tags') &&
        hasString(value, 'description') &&
        typeof value.isDefault === 'boolean' &&
        hasString(value, 'mimeType') &&
        String(value.mimeType).startsWith('image/') &&
        hasNumber(value, 'createdAt')
      break
    case 'backgrounds':
      valid =
        hasStringArray(value, 'tags') &&
        hasString(value, 'description') &&
        hasString(value, 'mimeType') &&
        String(value.mimeType).startsWith('image/') &&
        hasNumber(value, 'createdAt')
      break
  }
  if (!valid) throw createError({ statusCode: 400, statusMessage: 'Datos no válidos' })
  return value
}

async function readBinaryPayload(event: H3Event) {
  const parts = await readMultipartFormData(event)
  const metadataPart = parts?.find((part) => part.name === 'metadata')
  const filePart = parts?.find((part) => part.name === 'file')
  if (!metadataPart || !filePart) {
    throw createError({ statusCode: 400, statusMessage: 'Faltan metadatos o imagen' })
  }
  if (filePart.data.byteLength > MAX_IMAGE_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'La imagen supera 5 MB' })
  }
  let metadata: unknown
  try {
    metadata = JSON.parse(metadataPart.data.toString('utf8'))
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Metadatos no válidos' })
  }
  return { metadata: asRecord(metadata), data: filePart.data }
}

function mapStorageError(caught: unknown): never {
  if (caught && typeof caught === 'object' && 'statusCode' in caught) throw caught
  const error = caught as { code?: string; errcode?: number; message?: string }
  if (error.errcode === 787 || error.message?.includes('FOREIGN KEY constraint failed')) {
    throw createError({ statusCode: 400, statusMessage: 'Referencia de datos no válida' })
  }
  if (
    error.code === 'ERR_BACKGROUND_TAG_CONFLICT' ||
    error.errcode === 1555 ||
    error.errcode === 2067 ||
    error.message?.includes('UNIQUE constraint failed')
  ) {
    throw createError({ statusCode: 409, statusMessage: 'El registro entra en conflicto con otro' })
  }
  console.error('SQLite data API error', error)
  throw createError({ statusCode: 500, statusMessage: 'No se pudieron guardar los datos' })
}

export default defineEventHandler(async (event) => {
  try {
    const rawPath = getRouterParam(event, 'path') ?? ''
    const segments = rawPath.split('/').filter(Boolean)
    const query = getQuery(event)
    const scope = asScope(query.scope)
    const storage = getStorage()

    if (segments[0] === 'clear' && event.method === 'POST') {
      storage.clear(scope)
      return { ok: true }
    }

    if (
      segments[0] === 'messages' &&
      segments[1] === 'delete-many' &&
      event.method === 'POST'
    ) {
      const body = asRecord(await readBody(event))
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((id): id is string => typeof id === 'string' && Boolean(id))
        : []
      storage.deleteMessages(scope, ids)
      return { ok: true }
    }

    const resource = asResource(segments[0])
    const id = segments[1]

    if (
      (resource === 'images' || resource === 'backgrounds') &&
      id &&
      segments[2] === 'content' &&
      event.method === 'GET'
    ) {
      const binary = storage.getBinary(resource, scope, asId(id))
      if (!binary) throw createError({ statusCode: 404, statusMessage: 'Imagen no encontrada' })
      setResponseHeader(event, 'content-type', binary.mimeType)
      setResponseHeader(event, 'cache-control', 'private, max-age=300')
      return binary.data
    }

    if (event.method === 'GET') {
      if (id) {
        const value = storage.get(resource, scope, asId(id))
        if (!value) throw createError({ statusCode: 404, statusMessage: 'Registro no encontrado' })
        return value
      }
      return storage.list(resource, scope, {
        storyId: typeof query.storyId === 'string' ? query.storyId : undefined,
        characterId: typeof query.characterId === 'string' ? query.characterId : undefined
      })
    }

    if (event.method === 'PUT') {
      const resourceId = asId(id)
      if (resource === 'images' || resource === 'backgrounds') {
        const payload = await readBinaryPayload(event)
        payload.metadata = validatePayload(resource, payload.metadata)
        return storage.putBinary(resource, scope, resourceId, payload)
      }
      return storage.put(resource, scope, resourceId, validatePayload(resource, await readBody(event)))
    }

    if (event.method === 'DELETE') {
      storage.delete(resource, scope, asId(id))
      return { ok: true }
    }

    throw createError({ statusCode: 405, statusMessage: 'Método no permitido' })
  } catch (caught) {
    mapStorageError(caught)
  }
})
