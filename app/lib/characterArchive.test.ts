import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import type { Character } from '../../shared/types/index.ts'
import type { StoredImage, StoredSound } from './db.ts'
import {
  characterArchiveFilename,
  createCharacterArchive,
  normalizeCharacterName,
  readCharacterArchive
} from './characterArchive.ts'

const character: Character = {
  id: 'character-1',
  name: 'Ána Prueba',
  prompt: 'Prompt completo',
  tags: ['valiente'],
  color: '#123456',
  imageGenerationPreset: 'Retrato',
  imageGenerationLora: 'Detalle',
  imageGenerationSeed: '9243353',
  imageGenerationPromptPrefix: 'masterpiece, detailed portrait',
  archived: false,
  createdAt: 1,
  updatedAt: 2
}

const image: StoredImage = {
  id: 'image-1',
  characterId: character.id,
  tags: ['feliz'],
  isDefault: true,
  mimeType: 'image/png',
  createdAt: 3,
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
}

const sound: StoredSound = {
  id: 'sound-1',
  tags: ['saludo'],
  characterId: character.id,
  backgroundId: null,
  mimeType: 'audio/ogg',
  createdAt: 4,
  blob: new Blob([new Uint8Array([4, 5, 6])], { type: 'audio/ogg' })
}

test('crea y lee ZIP de personaje con imágenes y sonidos', async () => {
  const archive = await createCharacterArchive(character, [image], [sound])
  const imported = await readCharacterArchive(archive)

  assert.deepEqual(imported.character, {
    name: character.name,
    prompt: character.prompt,
    tags: character.tags,
    color: character.color,
    imageGenerationPreset: character.imageGenerationPreset,
    imageGenerationLora: character.imageGenerationLora,
    imageGenerationSeed: character.imageGenerationSeed,
    imageGenerationPromptPrefix: character.imageGenerationPromptPrefix
  })
  assert.deepEqual(imported.images[0], {
    tags: ['feliz'],
    isDefault: true,
    mimeType: 'image/png',
    blob: imported.images[0]!.blob
  })
  assert.deepEqual(
    Array.from(new Uint8Array(await imported.images[0]!.blob.arrayBuffer())),
    [1, 2, 3]
  )
  assert.deepEqual(imported.sounds[0]!.tags, ['saludo'])
  assert.deepEqual(
    Array.from(new Uint8Array(await imported.sounds[0]!.blob.arrayBuffer())),
    [4, 5, 6]
  )
})

test('conserva el recorte y la original al exportar e importar ZIP', async () => {
  const originalBlob = new Blob([new Uint8Array([7, 8, 9, 10])], { type: 'image/webp' })
  const archive = await createCharacterArchive(character, [{ ...image, hasOriginal: true, originalBlob }], [])
  const imported = await readCharacterArchive(archive)
  assert.deepEqual(new Uint8Array(await imported.images[0]!.originalBlob!.arrayBuffer()), new Uint8Array([7, 8, 9, 10]))
  assert.equal(imported.images[0]!.originalBlob!.type, 'image/webp')
  assert.deepEqual(new Uint8Array(await imported.images[0]!.blob.arrayBuffer()), new Uint8Array([1, 2, 3]))
})

test('rechaza versión incompatible y archivos ausentes', async () => {
  const incompatible = new JSZip()
  incompatible.file('character.json', JSON.stringify({
    version: 99,
    character: { name: 'Ana', prompt: '', tags: [], color: '#000000', imageGenerationPreset: '' },
    images: [],
    sounds: []
  }))
  await assert.rejects(
    readCharacterArchive(new Blob([await incompatible.generateAsync({ type: 'uint8array' })])),
    /Versión de personaje no compatible/
  )

  const missing = new JSZip()
  missing.file('character.json', JSON.stringify({
    version: 1,
    character: { name: 'Ana', prompt: '', tags: [], color: '#000000', imageGenerationPreset: '' },
    images: [{
      // Compatibilidad con ZIPs antiguos: la descripción se ignora.
      path: 'images/1.png', tags: [], description: '', isDefault: true, mimeType: 'image/png'
    }],
    sounds: []
  }))
  await assert.rejects(
    readCharacterArchive(new Blob([await missing.generateAsync({ type: 'uint8array' })])),
    /Falta el archivo images\/1.png/
  )
})

test('normaliza conflictos y nombre del fichero', () => {
  assert.equal(normalizeCharacterName('  ÁNA  '), normalizeCharacterName('ána'))
  assert.equal(characterArchiveFilename('Ána Prueba'), 'personaje-ana-prueba.zip')
})
