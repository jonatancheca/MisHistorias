import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MisHistoriasStorage } from './storage.ts'

function withStorage(run: (storage: MisHistoriasStorage, path: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-sqlite-'))
  const path = join(directory, 'test.sqlite')
  const storage = new MisHistoriasStorage(path)
  try {
    run(storage, path)
  } finally {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

function character(id: string) {
  return {
    id,
    name: `Personaje ${id}`,
    prompt: 'Prompt',
    tags: ['uno'],
    color: '#123456',
    createdAt: 1,
    updatedAt: 2
  }
}

function story(id: string) {
  return {
    id,
    title: `Historia ${id}`,
    premise: 'Premisa',
    protagonistPreferences: '',
    protagonistPreferencesMode: 'append',
    characterIds: [],
    initialBackgroundId: null,
    presetId: null,
    createdAt: 3,
    updatedAt: 4
  }
}

test('crea esquema, conserva datos al reabrir y separa ámbitos', () => {
  withStorage((storage, path) => {
    storage.put('characters', 'normal', 'normal-1', character('normal-1'))
    storage.put('characters', 'private', 'private-1', character('private-1'))
    storage.writeSettings({ model: 'modelo', apiKey: 'secreto' })
    storage.close()

    const reopened = new MisHistoriasStorage(path)
    try {
      assert.deepEqual(
        reopened.list('characters', 'normal').map((item) => item.id),
        ['normal-1']
      )
      assert.deepEqual(
        reopened.list('characters', 'private').map((item) => item.id),
        ['private-1']
      )
      assert.equal(reopened.readSettings()?.value.model, 'modelo')
      assert.equal(reopened.readSettings()?.apiKey, 'secreto')
      assert.equal(reopened.health().schemaVersion, 1)
    } finally {
      reopened.close()
    }
  })
})

test('guarda BLOB y mantiene una sola imagen predeterminada', () => {
  withStorage((storage) => {
    storage.put('characters', 'normal', 'character-1', character('character-1'))
    storage.putBinary('images', 'normal', 'image-1', {
      metadata: {
        id: 'image-1',
        characterId: 'character-1',
        tags: ['neutral'],
        description: 'Primera',
        isDefault: true,
        mimeType: 'image/png',
        createdAt: 1
      },
      data: new Uint8Array([1, 2, 3])
    })
    storage.putBinary('images', 'normal', 'image-2', {
      metadata: {
        id: 'image-2',
        characterId: 'character-1',
        tags: ['feliz'],
        description: 'Segunda',
        isDefault: true,
        mimeType: 'image/png',
        createdAt: 2
      },
      data: new Uint8Array([4, 5])
    })

    const images = storage.list('images', 'normal')
    assert.equal(images.filter((image) => image.isDefault).length, 1)
    assert.equal(images.find((image) => image.id === 'image-2')?.isDefault, true)
    assert.deepEqual(Array.from(storage.getBinary('images', 'normal', 'image-1')!.data), [1, 2, 3])

    storage.delete('characters', 'normal', 'character-1')
    assert.equal(storage.list('images', 'normal').length, 0)
  })
})

test('borra mensajes y trazas relacionadas dentro de transacción', () => {
  withStorage((storage) => {
    storage.put('stories', 'normal', 'story-1', story('story-1'))
    storage.put('messages', 'normal', 'user-1', {
      id: 'user-1',
      storyId: 'story-1',
      role: 'user',
      raw: 'Hola',
      segments: [],
      createdAt: 1
    })
    storage.put('messages', 'normal', 'assistant-1', {
      id: 'assistant-1',
      storyId: 'story-1',
      role: 'assistant',
      raw: 'Respuesta',
      segments: [],
      createdAt: 2
    })
    storage.put('llmDebugTraces', 'normal', 'trace-1', {
      id: 'trace-1',
      storyId: 'story-1',
      requestMessageId: 'user-1',
      responseMessageId: 'assistant-1',
      status: 'success',
      request: {},
      response: {},
      createdAt: 3
    })
    storage.deleteMessages('normal', ['assistant-1'])
    assert.deepEqual(
      storage.list('messages', 'normal', { storyId: 'story-1' }).map((message) => message.id),
      ['user-1']
    )
    assert.equal(storage.list('llmDebugTraces', 'normal', { storyId: 'story-1' }).length, 0)
  })
})

test('limpiar normal no toca privado ni ajustes', () => {
  withStorage((storage) => {
    storage.put('characters', 'normal', 'normal-1', character('normal-1'))
    storage.put('characters', 'private', 'private-1', character('private-1'))
    storage.writeSettings({ theme: 'dark' })
    storage.clear('normal')
    assert.equal(storage.list('characters', 'normal').length, 0)
    assert.equal(storage.list('characters', 'private').length, 1)
    assert.equal(storage.readSettings()?.value.theme, 'dark')
  })
})
