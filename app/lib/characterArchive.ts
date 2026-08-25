import JSZip from 'jszip'
import type { Character } from '../../shared/types/index.ts'
import type { StoredImage, StoredSound } from './db.ts'

export const CHARACTER_ARCHIVE_VERSION = 2
export const MAX_CHARACTER_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_CHARACTER_SOUND_BYTES = 10 * 1024 * 1024

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const SOUND_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg'])

interface ArchiveAsset {
  path: string
  tags: string[]
  mimeType: string
}

interface ArchiveImage extends ArchiveAsset {
  description: string
  isDefault: boolean
}

interface CharacterArchiveManifest {
  version: number
  character: Pick<Character, 'name' | 'prompt' | 'tags' | 'color' | 'imageGenerationPreset'> & {
    imageGenerationLora?: string
  }
  images: ArchiveImage[]
  sounds: ArchiveAsset[]
}

export interface ImportedCharacterArchive {
  character: Pick<Character, 'name' | 'prompt' | 'tags' | 'color' | 'imageGenerationPreset' | 'imageGenerationLora'>
  images: Array<Omit<ArchiveImage, 'path'> & { blob: Blob }>
  sounds: Array<Omit<ArchiveAsset, 'path'> & { blob: Blob }>
}

function extensionFor(mimeType: string) {
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg'
  }
  return extensions[mimeType.toLocaleLowerCase()] ?? 'bin'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isAsset(value: unknown, prefix: 'images/' | 'sounds/'):
  value is ArchiveAsset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const asset = value as Record<string, unknown>
  return (
    typeof asset.path === 'string' &&
    asset.path.startsWith(prefix) &&
    !asset.path.includes('..') &&
    typeof asset.mimeType === 'string' &&
    isStringArray(asset.tags)
  )
}

function assertManifest(value: unknown): asserts value is CharacterArchiveManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('El ZIP no contiene un personaje válido.')
  }
  const manifest = value as Record<string, unknown>
  if (manifest.version !== 1 && manifest.version !== CHARACTER_ARCHIVE_VERSION) {
    throw new Error('Versión de personaje no compatible.')
  }
  if (!manifest.character || typeof manifest.character !== 'object' || Array.isArray(manifest.character)) {
    throw new Error('El ZIP no contiene un personaje válido.')
  }
  const character = manifest.character as Record<string, unknown>
  if (
    typeof character.name !== 'string' || !character.name.trim() ||
    typeof character.prompt !== 'string' ||
    !isStringArray(character.tags) ||
    typeof character.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(character.color) ||
    typeof character.imageGenerationPreset !== 'string' ||
    (character.imageGenerationLora !== undefined && typeof character.imageGenerationLora !== 'string') ||
    !Array.isArray(manifest.images) ||
    !Array.isArray(manifest.sounds)
  ) {
    throw new Error('El ZIP no contiene un personaje válido.')
  }
  if (!manifest.images.every((item) => {
    if (!isAsset(item, 'images/')) return false
    const image = item as unknown as Record<string, unknown>
    return typeof image.description === 'string' && typeof image.isDefault === 'boolean'
  })) {
    throw new Error('El ZIP contiene imágenes no válidas.')
  }
  if (!manifest.sounds.every((item) => isAsset(item, 'sounds/'))) {
    throw new Error('El ZIP contiene sonidos no válidos.')
  }
  if (manifest.images.filter((item) => item.isDefault).length > 1) {
    throw new Error('El ZIP contiene varias imágenes predeterminadas.')
  }
  const paths = [...manifest.images, ...manifest.sounds].map((item) => item.path)
  if (new Set(paths).size !== paths.length) throw new Error('El ZIP contiene archivos duplicados.')
}

async function archiveBlob(
  zip: JSZip,
  asset: ArchiveAsset,
  allowedTypes: Set<string>,
  maximumBytes: number,
  label: string
) {
  const mimeType = asset.mimeType.toLocaleLowerCase()
  if (!allowedTypes.has(mimeType)) throw new Error(`${label} usa un formato no permitido.`)
  const entry = zip.file(asset.path)
  if (!entry) throw new Error(`Falta el archivo ${asset.path}.`)
  const bytes = await entry.async('uint8array')
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    throw new Error(`${label} supera el tamaño permitido o está vacío.`)
  }
  return new Blob([bytes], { type: mimeType })
}

export function normalizeCharacterName(value: string) {
  return value.trim().toLocaleLowerCase()
}

export function characterArchiveFilename(name: string) {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `personaje-${slug || 'sin-nombre'}.zip`
}

export async function createCharacterArchive(
  character: Character,
  images: StoredImage[],
  sounds: StoredSound[]
) {
  const zip = new JSZip()
  const manifest: CharacterArchiveManifest = {
    version: CHARACTER_ARCHIVE_VERSION,
    character: {
      name: character.name,
      prompt: character.prompt,
      tags: [...character.tags],
      color: character.color,
      imageGenerationPreset: character.imageGenerationPreset,
      imageGenerationLora: character.imageGenerationLora
    },
    images: images.map((image, index) => ({
      path: `images/${index + 1}.${extensionFor(image.mimeType)}`,
      tags: [...image.tags],
      description: image.description,
      isDefault: image.isDefault,
      mimeType: image.mimeType
    })),
    sounds: sounds.map((sound, index) => ({
      path: `sounds/${index + 1}.${extensionFor(sound.mimeType)}`,
      tags: [...sound.tags],
      mimeType: sound.mimeType
    }))
  }
  await Promise.all(manifest.images.map(async (image, index) => {
    zip.file(image.path, await images[index]!.blob.arrayBuffer())
  }))
  await Promise.all(manifest.sounds.map(async (sound, index) => {
    zip.file(sound.path, await sounds[index]!.blob.arrayBuffer())
  }))
  zip.file('character.json', JSON.stringify(manifest, null, 2))
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

export async function readCharacterArchive(file: Blob): Promise<ImportedCharacterArchive> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer())
  } catch {
    throw new Error('El fichero no es un ZIP válido.')
  }
  const manifestEntry = zip.file('character.json')
  if (!manifestEntry) throw new Error('Falta character.json en el ZIP.')
  let manifest: unknown
  try {
    manifest = JSON.parse(await manifestEntry.async('string'))
  } catch {
    throw new Error('character.json no es válido.')
  }
  assertManifest(manifest)
  return {
    character: {
      ...manifest.character,
      imageGenerationLora: manifest.character.imageGenerationLora ?? ''
    },
    images: await Promise.all(manifest.images.map(async (image) => ({
      tags: [...image.tags],
      description: image.description,
      isDefault: image.isDefault,
      mimeType: image.mimeType,
      blob: await archiveBlob(zip, image, IMAGE_TYPES, MAX_CHARACTER_IMAGE_BYTES, 'Una imagen')
    }))),
    sounds: await Promise.all(manifest.sounds.map(async (sound) => ({
      tags: [...sound.tags],
      mimeType: sound.mimeType,
      blob: await archiveBlob(zip, sound, SOUND_TYPES, MAX_CHARACTER_SOUND_BYTES, 'Un sonido')
    })))
  }
}
