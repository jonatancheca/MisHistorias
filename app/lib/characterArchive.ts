import { readImageGeneration } from '../../shared/utils/imageGeneration.ts'
import JSZip from 'jszip'
import type { Character, ImageGenerationMetadata } from '../../shared/types/index.ts'
import type { StoredImage, StoredSound } from './db.ts'

export const CHARACTER_ARCHIVE_VERSION = 6
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
  isDefault: boolean
  original?: ArchiveAsset
  generation?: ImageGenerationMetadata
}

interface CharacterArchiveManifest {
  version: number
  character: Pick<Character, 'name' | 'prompt' | 'tags' | 'color' | 'imageGenerationPreset'> & {
    imageGenerationLora?: string
    imageGenerationSeed?: string
    imageGenerationPromptPrefix?: string
  }
  images: ArchiveImage[]
  sounds: ArchiveAsset[]
}

export interface ImportedCharacterArchive {
  character: Pick<Character, 'name' | 'prompt' | 'tags' | 'color' | 'imageGenerationPreset' | 'imageGenerationLora' | 'imageGenerationSeed' | 'imageGenerationPromptPrefix'>
  images: Array<Omit<ArchiveImage, 'path' | 'original'> & { blob: Blob; originalBlob?: Blob }>
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
  if (
    manifest.version !== 1 &&
    manifest.version !== 2 &&
    manifest.version !== 3 &&
    manifest.version !== 4 &&
    manifest.version !== 5 &&
    manifest.version !== CHARACTER_ARCHIVE_VERSION
  ) {
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
    (character.imageGenerationSeed !== undefined && typeof character.imageGenerationSeed !== 'string') ||
    (character.imageGenerationPromptPrefix !== undefined && typeof character.imageGenerationPromptPrefix !== 'string') ||
    !Array.isArray(manifest.images) ||
    !Array.isArray(manifest.sounds)
  ) {
    throw new Error('El ZIP no contiene un personaje válido.')
  }
  if (!manifest.images.every((item) => {
    if (!isAsset(item, 'images/')) return false
    const image = item as unknown as Record<string, unknown>
    readImageGeneration(image.generation)
    return typeof image.isDefault === 'boolean' &&
      (image.original === undefined || isAsset(image.original, 'images/'))
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
  for (const image of manifest.images as ArchiveImage[]) {
    if (image.original) paths.push(image.original.path)
  }
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
  const bytes = await entry.async('arraybuffer')
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
  if (images.some((image) => image.hasOriginal && !image.originalBlob)) {
    throw new Error('Falta cargar una imagen original para exportar.')
  }
  const manifest: CharacterArchiveManifest = {
    version: CHARACTER_ARCHIVE_VERSION,
    character: {
      name: character.name,
      prompt: character.prompt,
      tags: [...character.tags],
      color: character.color,
      imageGenerationPreset: character.imageGenerationPreset,
      imageGenerationLora: character.imageGenerationLora,
      imageGenerationSeed: character.imageGenerationSeed,
      imageGenerationPromptPrefix: character.imageGenerationPromptPrefix
    },
    images: images.map((image, index) => ({
      path: `images/${index + 1}.${extensionFor(image.mimeType)}`,
      tags: [...image.tags],
      isDefault: image.isDefault,
      ...(image.generation ? { generation: readImageGeneration(image.generation) } : {}),
      mimeType: image.mimeType,
      ...(image.originalBlob ? {
        original: {
          path: `images/${index + 1}-original.${extensionFor(image.originalBlob.type)}`,
          tags: [],
          mimeType: image.originalBlob.type
        }
      } : {})
    })),
    sounds: sounds.map((sound, index) => ({
      path: `sounds/${index + 1}.${extensionFor(sound.mimeType)}`,
      tags: [...sound.tags],
      mimeType: sound.mimeType
    }))
  }
  await Promise.all(manifest.images.map(async (image, index) => {
    zip.file(image.path, await images[index]!.blob.arrayBuffer())
    if (image.original) {
      zip.file(image.original.path, await images[index]!.originalBlob!.arrayBuffer())
    }
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
      imageGenerationLora: manifest.character.imageGenerationLora ?? '',
      imageGenerationSeed: manifest.character.imageGenerationSeed ?? '',
      imageGenerationPromptPrefix: manifest.character.imageGenerationPromptPrefix ?? ''
    },
    images: await Promise.all(manifest.images.map(async (image) => ({
      tags: [...image.tags],
      isDefault: image.isDefault,
      ...(image.generation ? { generation: readImageGeneration(image.generation) } : {}),
      mimeType: image.mimeType,
      blob: await archiveBlob(zip, image, IMAGE_TYPES, MAX_CHARACTER_IMAGE_BYTES, 'Una imagen'),
      ...(image.original ? {
        originalBlob: await archiveBlob(zip, image.original, IMAGE_TYPES, MAX_CHARACTER_IMAGE_BYTES, 'La original')
      } : {})
    }))),
    sounds: await Promise.all(manifest.sounds.map(async (sound) => ({
      tags: [...sound.tags],
      mimeType: sound.mimeType,
      blob: await archiveBlob(zip, sound, SOUND_TYPES, MAX_CHARACTER_SOUND_BYTES, 'Un sonido')
    })))
  }
}
