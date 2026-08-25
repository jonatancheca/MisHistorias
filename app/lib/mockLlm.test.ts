import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Character } from '#shared/types'
import type { StoredBackground, StoredImage } from './db.ts'
import { buildMockResponse } from './mockLlm.ts'

const character: Character = {
  id: 'character-1',
  name: 'Alicia',
  prompt: '',
  tags: [],
  color: '#db2777',
  imageGenerationPreset: '',
  imageGenerationLora: '',
  archived: false,
  createdAt: 1,
  updatedAt: 1
}
const image: StoredImage = {
  id: 'image-1',
  characterId: character.id,
  tags: ['feliz', 'armadura'],
  isDefault: true,
  mimeType: 'image/png',
  createdAt: 1,
  blob: new Blob()
}
const background: StoredBackground = {
  id: 'background-1',
  tags: ['bosque', 'exterior'],
  description: '',
  mimeType: 'image/png',
  createdAt: 1,
  blob: new Blob()
}
const sound = {
  id: 'sound-1',
  tags: ['ramas'],
  characterId: null,
  backgroundId: background.id,
  mimeType: 'audio/wav',
  createdAt: 1
}

describe('LLM simulado', () => {
  it('usa personajes, imágenes y fondos disponibles', () => {
    const originalRandom = Math.random
    Math.random = () => 0
    try {
      const response = buildMockResponse(
        [character],
        [image],
        [background],
        [sound],
        null,
        'continue',
        'Usuario'
      )
      assert.match(response, /Fondo \[bosque\]:/)
      assert.match(response, /Alicia \[feliz\]\[armadura\]:/)
      assert.match(response, /Sonido \[ramas\]:/)
      assert.doesNotMatch(response, /Usuario:/)
    } finally {
      Math.random = originalRandom
    }
  })

  it('incluye decisiones y diálogo del protagonista solo en Auto', () => {
    const originalRandom = Math.random
    Math.random = () => 0
    try {
      const response = buildMockResponse([character], [], [], [], null, 'auto', 'Vera')
      assert.match(response, /Vera: Decido seguir adelante\./)
      assert.match(response, /Vera avanza con cautela\./)
      assert.match(response, /Alicia \[neutral\]:/)
    } finally {
      Math.random = originalRandom
    }
  })

  it('respeta etiquetas visuales pendientes en la primera intervención', () => {
    const originalRandom = Math.random
    Math.random = () => 0
    try {
      const response = buildMockResponse(
        [character],
        [image],
        [],
        [],
        null,
        'continue',
        'Vera',
        [{ characterId: character.id, imageId: 'image-2', tags: ['seria', 'capa'] }]
      )
      assert.match(response, /Alicia \[seria\]\[capa\]:/)
    } finally {
      Math.random = originalRandom
    }
  })
})
