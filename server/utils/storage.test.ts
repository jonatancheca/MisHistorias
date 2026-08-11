import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
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
    visualMode: false,
    protagonistPreferences: '',
    protagonistPreferencesMode: 'append',
    characterIds: [],
    characterCustomizations: [],
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
    storage.put('stories', 'normal', 'story-normal', {
      ...story('story-normal'),
      visualMode: true,
      characterIds: ['normal-1'],
      characterCustomizations: [
        { characterId: 'normal-1', prompt: 'Prompt normal', tags: ['normal'] }
      ]
    })
    storage.put('stories', 'private', 'story-private', {
      ...story('story-private'),
      characterIds: ['private-1'],
      characterCustomizations: [
        { characterId: 'private-1', prompt: 'Prompt privado', tags: ['privado'] }
      ]
    })
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
      assert.deepEqual(reopened.get('stories', 'normal', 'story-normal')?.characterCustomizations, [
        { characterId: 'normal-1', prompt: 'Prompt normal', tags: ['normal'] }
      ])
      assert.deepEqual(
        reopened.get('stories', 'private', 'story-private')?.characterCustomizations,
        [{ characterId: 'private-1', prompt: 'Prompt privado', tags: ['privado'] }]
      )
      assert.equal(reopened.readSettings()?.value.model, 'modelo')
      assert.equal(reopened.readSettings()?.apiKey, 'secreto')
      assert.equal(
        (reopened.get('stories', 'normal', 'story-normal') as { visualMode?: boolean } | null)
          ?.visualMode,
        true
      )
      assert.equal(reopened.health().schemaVersion, 3)
    } finally {
      reopened.close()
    }
  })
})

test('migra v1 a v3 copiando personajes y dejando modo visual desactivado', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-sqlite-v1-'))
  const path = join(directory, 'test.sqlite')
  const legacy = new DatabaseSync(path)
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE characters (
      scope TEXT NOT NULL CHECK (scope IN ('normal', 'private')),
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (scope, id)
    ) STRICT;
    CREATE TABLE stories (
      scope TEXT NOT NULL CHECK (scope IN ('normal', 'private')),
      id TEXT NOT NULL,
      title TEXT NOT NULL,
      premise TEXT NOT NULL,
      protagonist_preferences TEXT NOT NULL,
      protagonist_preferences_mode TEXT NOT NULL CHECK (protagonist_preferences_mode IN ('append', 'replace')),
      character_ids_json TEXT NOT NULL,
      initial_background_id TEXT,
      preset_id TEXT,
      image_catalog_snapshot_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (scope, id)
    ) STRICT;
    PRAGMA user_version = 1;
  `)
  legacy
    .prepare(`
      INSERT INTO characters(scope, id, name, prompt, tags_json, color, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run('normal', 'character-1', 'Alicia', 'Prompt original', '["aventurera"]', '#123456', 1, 1)
  legacy
    .prepare(`
      INSERT INTO stories(
        scope, id, title, premise, protagonist_preferences, protagonist_preferences_mode,
        character_ids_json, initial_background_id, preset_id, image_catalog_snapshot_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run('normal', 'story-1', 'Historia', 'Premisa', '', 'append', '["character-1"]', null, null, null, 2, 2)
  legacy.close()

  const storage = new MisHistoriasStorage(path)
  try {
    assert.equal(storage.health().schemaVersion, 3)
    assert.equal(
      (storage.get('stories', 'normal', 'story-1') as { visualMode?: boolean } | null)
        ?.visualMode,
      false
    )
    assert.deepEqual(storage.get('stories', 'normal', 'story-1')?.characterCustomizations, [
      {
        characterId: 'character-1',
        prompt: 'Prompt original',
        tags: ['aventurera']
      }
    ])
  } finally {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
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
