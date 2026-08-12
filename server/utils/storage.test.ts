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
    storage.writeSettings({
      model: 'modelo',
      apiKey: 'secreto',
      visualNovelManualAdvance: true
    })
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
      assert.equal(reopened.readSettings()?.value.visualNovelManualAdvance, true)
      assert.equal(reopened.readSettings()?.apiKey, 'secreto')
      assert.equal(
        (reopened.get('stories', 'normal', 'story-normal') as { visualMode?: boolean } | null)
          ?.visualMode,
        true
      )
      assert.equal(reopened.health().schemaVersion, 4)
    } finally {
      reopened.close()
    }
  })
})

test('migra v1 a v4 copiando personajes y dejando modo visual desactivado', () => {
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
    assert.equal(storage.health().schemaVersion, 4)
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

test('migra imágenes v3 a BLOBs referenciados sin perder contenido', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-sqlite-v3-'))
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
    CREATE TABLE images (
      scope TEXT NOT NULL CHECK (scope IN ('normal', 'private')),
      id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      description TEXT NOT NULL,
      is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
      mime_type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (scope, id),
      FOREIGN KEY (scope, character_id) REFERENCES characters(scope, id) ON DELETE CASCADE
    ) STRICT;
    PRAGMA user_version = 3;
  `)
  legacy
    .prepare(`
      INSERT INTO characters(scope, id, name, prompt, tags_json, color, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run('normal', 'character-1', 'Alicia', 'Prompt', '[]', '#123456', 1, 1)
  legacy
    .prepare(`
      INSERT INTO images(
        scope, id, character_id, tags_json, description, is_default,
        mime_type, created_at, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      'normal',
      'image-1',
      'character-1',
      '["neutral"]',
      'Original',
      1,
      'image/png',
      1,
      new Uint8Array([7, 8, 9])
    )
  legacy.close()

  const storage = new MisHistoriasStorage(path)
  try {
    assert.equal(storage.health().schemaVersion, 4)
    assert.deepEqual(Array.from(storage.getBinary('images', 'normal', 'image-1')!.data), [7, 8, 9])
    const row = storage.database
      .prepare('SELECT blob_id FROM images WHERE scope = ? AND id = ?')
      .get('normal', 'image-1') as { blob_id: string }
    assert.equal(row.blob_id, 'image-1')
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

test('copia personajes con imágenes nuevas y BLOBs compartidos dentro del ámbito', () => {
  withStorage((storage) => {
    storage.put('characters', 'normal', 'source', character('source'))
    storage.put('characters', 'private', 'private-source', character('private-source'))
    storage.putBinary('images', 'normal', 'image-1', {
      metadata: {
        id: 'image-1',
        characterId: 'source',
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
        characterId: 'source',
        tags: ['feliz'],
        description: 'Segunda',
        isDefault: false,
        mimeType: 'image/png',
        createdAt: 2
      },
      data: new Uint8Array([4, 5, 6])
    })

    const copied = storage.copyCharacter('normal', 'source', {
      name: 'Copia editable',
      prompt: 'Prompt copiado',
      tags: ['dos'],
      color: '#654321'
    })!
    assert.notEqual(copied.character.id, 'source')
    assert.equal(copied.character.name, 'Copia editable')
    assert.deepEqual(copied.images.map((image) => image.tags), [['neutral'], ['feliz']])
    assert.deepEqual(copied.images.map((image) => image.description), ['Primera', 'Segunda'])
    assert.deepEqual(copied.images.map((image) => image.isDefault), [true, false])
    assert.ok(copied.images.every((image) => !['image-1', 'image-2'].includes(image.id)))

    const references = storage.database
      .prepare(`
        SELECT character_id, created_at, blob_id
        FROM images
        WHERE scope = 'normal'
        ORDER BY created_at, character_id
      `)
      .all() as Array<{ character_id: string; created_at: number; blob_id: string }>
    assert.equal(references.length, 4)
    assert.equal(references[0]!.blob_id, references[1]!.blob_id)
    assert.equal(references[2]!.blob_id, references[3]!.blob_id)
    assert.equal(
      (storage.database.prepare('SELECT COUNT(*) AS total FROM image_blobs').get() as { total: number })
        .total,
      2
    )
    assert.equal(storage.copyCharacter('private', 'source', character('ignored')), null)

    const firstCopy = copied.images[0]!
    storage.putBinary('images', 'normal', firstCopy.id, {
      metadata: { ...firstCopy, tags: ['editada'] },
      data: new Uint8Array([1, 2, 3])
    })
    assert.equal(
      (storage.database.prepare('SELECT COUNT(*) AS total FROM image_blobs').get() as { total: number })
        .total,
      2
    )

    storage.putBinary('images', 'normal', firstCopy.id, {
      metadata: { ...firstCopy, tags: ['reemplazada'] },
      data: new Uint8Array([9, 9, 9])
    })
    assert.equal(
      (storage.database.prepare('SELECT COUNT(*) AS total FROM image_blobs').get() as { total: number })
        .total,
      3
    )

    storage.delete('characters', 'normal', 'source')
    assert.deepEqual(
      Array.from(storage.getBinary('images', 'normal', copied.images[1]!.id)!.data),
      [4, 5, 6]
    )
    assert.equal(
      (storage.database.prepare('SELECT COUNT(*) AS total FROM image_blobs').get() as { total: number })
        .total,
      2
    )
    storage.delete('characters', 'normal', copied.character.id)
    assert.equal(
      (storage.database.prepare('SELECT COUNT(*) AS total FROM image_blobs').get() as { total: number })
        .total,
      0
    )
  })
})

test('copia personaje sin imágenes', () => {
  withStorage((storage) => {
    storage.put('characters', 'normal', 'source', character('source'))
    const copied = storage.copyCharacter('normal', 'source', {
      name: 'Sin imágenes',
      prompt: 'Prompt',
      tags: [],
      color: '#123456'
    })!
    assert.equal(copied.images.length, 0)
    assert.equal(storage.list('characters', 'normal').length, 2)
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
