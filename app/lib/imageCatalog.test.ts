import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Character } from '#shared/types'
import type { StoredImage } from './db.ts'
import {
  buildStoryImageCatalog,
  compareStoryImageCatalogs,
  formatStoryImageCatalogChange
} from './imageCatalog.ts'

const characters: Character[] = [
  {
    id: 'character-b',
    name: 'Bruno',
    prompt: '',
    tags: [],
    color: '#000000',
    createdAt: 1,
    updatedAt: 1
  },
  {
    id: 'character-a',
    name: 'Alicia',
    prompt: '',
    tags: [],
    color: '#ffffff',
    createdAt: 1,
    updatedAt: 1
  }
]

const images: StoredImage[] = [
  {
    id: 'image-b',
    characterId: 'character-b',
    tags: ['serio'],
    description: 'Bruno alerta',
    isDefault: false,
    mimeType: 'image/png',
    createdAt: 1,
    blob: new Blob()
  },
  {
    id: 'image-a',
    characterId: 'character-a',
    tags: ['feliz'],
    description: 'Alicia sonríe',
    isDefault: true,
    mimeType: 'image/png',
    createdAt: 1,
    blob: new Blob()
  }
]

describe('catálogo de imágenes de historia', () => {
  it('filtra personajes, copia datos y ordena de forma estable', () => {
    const catalog = buildStoryImageCatalog(['character-a'], characters, images)
    assert.deepEqual(catalog, [
      {
        imageId: 'image-a',
        characterId: 'character-a',
        characterName: 'Alicia',
        tags: ['feliz'],
        description: 'Alicia sonríe',
        isDefault: true
      }
    ])
    images[1]!.tags[0] = 'cambiada'
    assert.deepEqual(catalog[0]!.tags, ['feliz'])
  })

  it('detecta altas, bajas y campos actualizados', () => {
    const previous = buildStoryImageCatalog(['character-a', 'character-b'], characters, images)
    const current = [
      {
        ...previous.find((entry) => entry.imageId === 'image-a')!,
        tags: ['armadura'],
        description: 'Nueva descripción',
        isDefault: false
      },
      {
        imageId: 'image-c',
        characterId: 'character-a',
        characterName: 'Alicia',
        tags: ['neutral'],
        description: '',
        isDefault: true
      }
    ]

    const change = compareStoryImageCatalogs(previous, current)
    assert.ok(change)
    assert.deepEqual(change.added.map((entry) => entry.imageId), ['image-c'])
    assert.deepEqual(change.removed.map((entry) => entry.imageId), ['image-b'])
    assert.deepEqual(change.updated[0]?.fields, ['tags', 'description', 'isDefault'])
    assert.match(formatStoryImageCatalogChange(change), /Añadida: Alicia \[neutral\]/)
    assert.match(formatStoryImageCatalogChange(change), /Eliminada: Bruno \[serio\]/)
  })

  it('devuelve null cuando no cambia nada', () => {
    const catalog = buildStoryImageCatalog(['character-a'], characters, images)
    assert.equal(compareStoryImageCatalogs(catalog, structuredClone(catalog)), null)
  })
})
