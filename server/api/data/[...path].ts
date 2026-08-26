import type { H3Event } from 'h3'
import type {
  BinaryPayload,
  CharacterImportPayload,
  DataResource,
  DataScope
} from '../../utils/storage'
import { getStorage } from '../../utils/storage'

const RESOURCES = new Set<DataResource>([
  'characters',
  'images',
  'backgrounds',
  'sounds',
  'stories',
  'messages',
  'llmDebugTraces',
  'storySaves',
  'presets'
])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_SOUND_BYTES = 10 * 1024 * 1024
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const SOUND_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg'])

function asScope(value: unknown): DataScope {
  if (value === 'normal' || value === 'private') return value
  throw createError({ statusCode: 400, message: 'Ámbito de datos no válido' })
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
  throw createError({ statusCode: 400, message: 'Datos no válidos' })
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
        (customization.name === undefined || typeof customization.name === 'string') &&
        (
          customization.color === undefined ||
          (typeof customization.color === 'string' && /^#[0-9a-f]{6}$/i.test(customization.color))
        ) &&
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
        hasString(value, 'imageGenerationPreset') &&
        hasString(value, 'imageGenerationLora') &&
        typeof value.archived === 'boolean' &&
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
    case 'storySaves':
      valid =
        hasString(value, 'storyId') &&
        hasString(value, 'name') &&
        Boolean(value.story) &&
        typeof value.story === 'object' &&
        !Array.isArray(value.story) &&
        Array.isArray(value.messages) &&
        Array.isArray(value.debugTraces) &&
        hasString(value, 'thumbnailDataUrl') &&
        String(value.thumbnailDataUrl).startsWith('data:image/webp;base64,') &&
        String(value.thumbnailDataUrl).length <= 2_000_000 &&
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
    case 'sounds':
      valid =
        hasStringArray(value, 'tags') &&
        value.tags.length > 0 &&
        (value.characterId === null || typeof value.characterId === 'string') &&
        (value.backgroundId === null || typeof value.backgroundId === 'string') &&
        !(typeof value.characterId === 'string' && typeof value.backgroundId === 'string') &&
        hasString(value, 'mimeType') &&
        ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg'].includes(
          String(value.mimeType).toLocaleLowerCase()
        ) &&
        hasNumber(value, 'createdAt')
      break
  }
  if (!valid) throw createError({ statusCode: 400, message: 'Datos no válidos' })
  return value
}

function validateCharacterCopy(rawValue: unknown) {
  const value = asRecord(rawValue)
  if (
    !hasString(value, 'name') ||
    !String(value.name).trim() ||
    !hasString(value, 'prompt') ||
    !hasStringArray(value, 'tags') ||
    !hasString(value, 'color') ||
    !hasString(value, 'imageGenerationPreset') ||
    !hasString(value, 'imageGenerationLora')
  ) {
    throw createError({ statusCode: 400, message: 'Datos no válidos' })
  }
  return value
}

async function readBinaryPayload(event: H3Event, resource: 'images' | 'backgrounds' | 'sounds') {
  const parts = await readMultipartFormData(event)
  const metadataPart = parts?.find((part) => part.name === 'metadata')
  const filePart = parts?.find((part) => part.name === 'file')
  if (!metadataPart || !filePart) {
    throw createError({ statusCode: 400, message: 'Faltan metadatos o archivo' })
  }
  const maximum = resource === 'sounds' ? MAX_SOUND_BYTES : MAX_IMAGE_BYTES
  if (filePart.data.byteLength > maximum) {
    if (resource === 'sounds') {
      throw createError({ statusCode: 413, statusMessage: 'El sonido supera 10 MB' })
    }
    throw createError({ statusCode: 413, statusMessage: 'La imagen supera 5 MB' })
  }
  let metadata: unknown
  try {
    metadata = JSON.parse(metadataPart.data.toString('utf8'))
  } catch {
    throw createError({ statusCode: 400, message: 'Metadatos no válidos' })
  }
  return { metadata: asRecord(metadata), data: filePart.data }
}

function importAssets(
  rawAssets: unknown,
  parts: Awaited<ReturnType<typeof readMultipartFormData>>,
  kind: 'images' | 'sounds'
) {
  if (!Array.isArray(rawAssets)) throw createError({ statusCode: 400, message: 'Archivos no válidos' })
  const allowedTypes = kind === 'images' ? IMAGE_TYPES : SOUND_TYPES
  const maximum = kind === 'images' ? MAX_IMAGE_BYTES : MAX_SOUND_BYTES
  const seenFields = new Set<string>()
  let defaultImages = 0
  return rawAssets.map((rawAsset): BinaryPayload => {
    const asset = asRecord(rawAsset)
    const field = typeof asset.field === 'string' ? asset.field : ''
    const mimeType = typeof asset.mimeType === 'string' ? asset.mimeType.toLocaleLowerCase() : ''
    if (!field || seenFields.has(field) || !allowedTypes.has(mimeType) || !hasStringArray(asset, 'tags')) {
      throw createError({ statusCode: 400, message: 'Archivos no válidos' })
    }
    if (kind === 'sounds' && asset.tags.length === 0) {
      throw createError({ statusCode: 400, message: 'Cada sonido necesita etiquetas' })
    }
    if (
      kind === 'images' &&
      typeof asset.isDefault !== 'boolean'
    ) {
      throw createError({ statusCode: 400, message: 'Imágenes no válidas' })
    }
    if (kind === 'images' && asset.isDefault) defaultImages += 1
    if (defaultImages > 1) {
      throw createError({ statusCode: 400, message: 'Solo puede haber una imagen predeterminada' })
    }
    seenFields.add(field)
    const file = parts?.find((part) => part.name === field)
    if (!file || file.data.byteLength === 0 || file.data.byteLength > maximum) {
      throw createError({ statusCode: 400, message: 'Archivo ausente o demasiado grande' })
    }
    return {
      metadata: {
        tags: asset.tags,
        isDefault: kind === 'images' ? asset.isDefault : undefined,
        mimeType
      },
      data: file.data
    }
  })
}

async function readCharacterImport(event: H3Event) {
  const parts = await readMultipartFormData(event)
  const metadataPart = parts?.find((part) => part.name === 'metadata')
  if (!metadataPart) throw createError({ statusCode: 400, statusMessage: 'Faltan metadatos' })
  let rawMetadata: unknown
  try {
    rawMetadata = JSON.parse(metadataPart.data.toString('utf8'))
  } catch {
    throw createError({ statusCode: 400, message: 'Metadatos no válidos' })
  }
  const metadata = asRecord(rawMetadata)
  const character = asRecord(metadata.character)
  const name = typeof metadata.name === 'string' ? metadata.name.trim() : ''
  if (
    (metadata.mode !== 'new' && metadata.mode !== 'replace') ||
    !name ||
    !hasString(character, 'prompt') ||
    !hasStringArray(character, 'tags') ||
    !hasString(character, 'color') || !/^#[0-9a-f]{6}$/i.test(String(character.color)) ||
    !hasString(character, 'imageGenerationPreset') ||
    !hasString(character, 'imageGenerationLora')
  ) {
    throw createError({ statusCode: 400, message: 'Personaje no válido' })
  }
  const targetId = metadata.mode === 'replace' ? asId(metadata.targetId) : null
  const payload: CharacterImportPayload = {
    name,
    prompt: String(character.prompt),
    tags: character.tags as string[],
    color: String(character.color),
    imageGenerationPreset: String(character.imageGenerationPreset),
    imageGenerationLora: String(character.imageGenerationLora),
    images: importAssets(metadata.images, parts, 'images'),
    sounds: importAssets(metadata.sounds, parts, 'sounds')
  }
  return { targetId, payload }
}

function mapStorageError(caught: unknown): never {
  if (caught && typeof caught === 'object' && 'statusCode' in caught) throw caught
  const error = caught as { code?: string; errcode?: number; message?: string }
  if (error.code === 'ERR_CHARACTER_IN_USE') {
    const stories = (caught as { stories?: Array<{ id: string; title: string }> }).stories ?? []
    throw createError({
      statusCode: 409,
      message: 'El personaje se usa en historias',
      data: { stories }
    })
  }
  if (error.errcode === 787 || error.message?.includes('FOREIGN KEY constraint failed')) {
    throw createError({ statusCode: 400, message: 'Referencia de datos no válida' })
  }
  if (
    error.code === 'ERR_BACKGROUND_TAG_CONFLICT' ||
    error.code === 'ERR_SOUND_TAG_CONFLICT' ||
    error.errcode === 1555 ||
    error.errcode === 2067 ||
    error.message?.includes('UNIQUE constraint failed')
  ) {
    throw createError({ statusCode: 409, message: 'El registro entra en conflicto con otro' })
  }
  console.error('SQLite data API error', error)
  throw createError({ statusCode: 500, message: 'No se pudieron guardar los datos' })
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

    if (
      segments[0] === 'characters' &&
      segments[1] === 'import' &&
      event.method === 'POST'
    ) {
      const imported = await readCharacterImport(event)
      const result = storage.importCharacter(scope, imported.targetId, imported.payload)
      if (!result) throw createError({ statusCode: 404, statusMessage: 'Personaje no encontrado' })
      return result
    }

    if (
      segments[0] === 'characters' &&
      segments[1] &&
      segments[2] === 'copy' &&
      event.method === 'POST'
    ) {
      const copied = storage.copyCharacter(
        scope,
        asId(segments[1]),
        validateCharacterCopy(await readBody(event))
      )
      if (!copied) throw createError({ statusCode: 404, statusMessage: 'Personaje no encontrado' })
      return copied
    }

    if (
      segments[0] === 'storySaves' &&
      segments[1] &&
      segments[2] === 'create' &&
      event.method === 'POST'
    ) {
      const body = asRecord(await readBody(event))
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const thumbnailDataUrl = typeof body.thumbnailDataUrl === 'string'
        ? body.thumbnailDataUrl
        : ''
      if (
        !name ||
        name.length > 200 ||
        !thumbnailDataUrl.startsWith('data:image/webp;base64,') ||
        thumbnailDataUrl.length > 2_000_000
      ) {
        throw createError({ statusCode: 400, message: 'Partida no válida' })
      }
      const save = storage.createStorySave(
        scope,
        asId(segments[1]),
        name,
        thumbnailDataUrl
      )
      if (!save) throw createError({ statusCode: 404, statusMessage: 'Historia no encontrada' })
      return save
    }

    if (
      segments[0] === 'storySaves' &&
      segments[1] &&
      segments[2] === 'load' &&
      event.method === 'POST'
    ) {
      const loaded = storage.loadStorySave(scope, asId(segments[1]))
      if (!loaded) throw createError({ statusCode: 404, statusMessage: 'Partida no encontrada' })
      return loaded
    }

    const resource = asResource(segments[0])
    const id = segments[1]

    if (
      (resource === 'images' || resource === 'backgrounds' || resource === 'sounds') &&
      id &&
      segments[2] === 'content' &&
      event.method === 'GET'
    ) {
      const binary = storage.getBinary(resource, scope, asId(id))
      if (!binary) throw createError({ statusCode: 404, statusMessage: 'Archivo no encontrado' })
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
      if (resource === 'images' || resource === 'backgrounds' || resource === 'sounds') {
        const payload = await readBinaryPayload(event, resource)
        payload.metadata = validatePayload(resource, payload.metadata)
        return storage.putBinary(resource, scope, resourceId, payload)
      }
      return storage.put(resource, scope, resourceId, validatePayload(resource, await readBody(event)))
    }

    if (event.method === 'DELETE') {
      storage.delete(resource, scope, asId(id))
      return { ok: true }
    }

    throw createError({ statusCode: 405, message: 'Método no permitido' })
  } catch (caught) {
    mapStorageError(caught)
  }
})
