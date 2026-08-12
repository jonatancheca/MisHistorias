import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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

function migrationBackups(path: string) {
  const backupDirectory = join(dirname(path), 'backups')
  if (!existsSync(backupDirectory)) return []
  return readdirSync(backupDirectory)
    .filter((name) => name.endsWith('.sqlite'))
    .map((name) => join(backupDirectory, name))
}

function createVersionedDatabase(path: string, version = 3) {
  const database = new DatabaseSync(path)
  database.exec(`
    CREATE TABLE legacy_marker (value TEXT NOT NULL) STRICT;
    INSERT INTO legacy_marker(value) VALUES ('original');
    PRAGMA user_version = ${version};
  `)
  database.close()
}

test('crea esquema, conserva datos al reabrir y separa ámbitos', () => {
  withStorage((storage, path) => {
    assert.equal(existsSync(join(dirname(path), 'backups')), false)
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
      assert.equal(reopened.health().schemaVersion, 5)
    } finally {
      reopened.close()
    }
  })
})

test('migra v1 a v5 copiando personajes y dejando modo visual desactivado', () => {
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
    const backups = migrationBackups(path)
    assert.equal(backups.length, 1)
    const backup = new DatabaseSync(backups[0]!, { readOnly: true })
    try {
      assert.equal(
        (backup.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
        1
      )
      assert.equal(
        (backup.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check,
        'ok'
      )
      const columns = backup.prepare('PRAGMA table_info(stories)').all() as Array<{ name: string }>
      assert.equal(columns.some((column) => column.name === 'character_customizations_json'), false)
    } finally {
      backup.close()
    }
    assert.equal(storage.health().schemaVersion, 5)
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
      INSERT INTO characters(scope, id, name, prompt, tags_json, color, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run('private', 'private-1', 'Privado', 'Secreto', '[]', '#654321', 1, 1)
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
    const backups = migrationBackups(path)
    assert.equal(backups.length, 1)
    const backup = new DatabaseSync(backups[0]!, { readOnly: true })
    try {
      assert.equal(
        (backup.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
        3
      )
      assert.equal(
        (backup.prepare("SELECT name FROM characters WHERE scope = 'private'").get() as {
          name: string
        }).name,
        'Privado'
      )
      const columns = backup.prepare('PRAGMA table_info(images)').all() as Array<{ name: string }>
      assert.equal(columns.some((column) => column.name === 'data'), true)
      assert.equal(columns.some((column) => column.name === 'blob_id'), false)
    } finally {
      backup.close()
    }
    assert.equal(storage.health().schemaVersion, 5)
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

test('conserva backup y revierte la base original si falla la migración', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-sqlite-failed-migration-'))
  const path = join(directory, 'test.sqlite')
  const legacy = new DatabaseSync(path)
  legacy.exec(`
    CREATE TABLE images (
      scope TEXT NOT NULL,
      id TEXT NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (scope, id)
    ) STRICT;
    INSERT INTO images(scope, id, data) VALUES ('normal', 'image-1', X'010203');
    PRAGMA user_version = 3;
  `)
  legacy.close()

  try {
    assert.throws(
      () => new MisHistoriasStorage(path),
      /Falló la migración SQLite v3 a v5\. Backup:/
    )

    const backups = migrationBackups(path)
    assert.equal(backups.length, 1)
    const backup = new DatabaseSync(backups[0]!, { readOnly: true })
    const source = new DatabaseSync(path, { readOnly: true })
    try {
      assert.equal(
        (backup.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
        3
      )
      assert.equal(
        (source.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
        3
      )
      const sourceColumns = source.prepare('PRAGMA table_info(images)').all() as Array<{
        name: string
      }>
      assert.deepEqual(
        sourceColumns.map((column) => column.name),
        ['scope', 'id', 'data']
      )
    } finally {
      backup.close()
      source.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('no inicia la migración si no puede crear el backup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-sqlite-failed-backup-'))
  const path = join(directory, 'test.sqlite')
  createVersionedDatabase(path)
  writeFileSync(join(directory, 'backups'), 'ruta bloqueada')

  try {
    assert.throws(
      () => new MisHistoriasStorage(path),
      /No se pudo crear el backup previo de SQLite\. Migración v3 a v5 no iniciada\./
    )
    const source = new DatabaseSync(path, { readOnly: true })
    try {
      assert.equal(
        (source.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
        3
      )
      assert.equal(
        (source.prepare('SELECT value FROM legacy_marker').get() as { value: string }).value,
        'original'
      )
      assert.equal(
        (
          source
            .prepare("SELECT COUNT(*) AS total FROM sqlite_schema WHERE name = 'characters'")
            .get() as { total: number }
        ).total,
        0
      )
    } finally {
      source.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('conserva solo los cinco backups más recientes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-sqlite-backup-retention-'))
  const path = join(directory, 'test.sqlite')
  const backupDirectory = join(directory, 'backups')
  createVersionedDatabase(path)
  mkdirSync(backupDirectory)

  const oldBackups = Array.from({ length: 6 }, (_, index) => {
    const backupPath = join(
      backupDirectory,
      `test.from-v1-to-v2-2026010${index + 1}T000000000Z.sqlite`
    )
    writeFileSync(backupPath, `backup-${index + 1}`)
    const modifiedAt = new Date(Date.UTC(2026, 0, index + 1))
    utimesSync(backupPath, modifiedAt, modifiedAt)
    return backupPath
  })

  const storage = new MisHistoriasStorage(path)
  try {
    const backups = migrationBackups(path)
    assert.equal(backups.length, 5)
    assert.equal(backups.includes(oldBackups[0]!), false)
    assert.equal(backups.includes(oldBackups[1]!), false)
  } finally {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('crea, lista y restaura backups manuales conservando todos los ámbitos', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-sqlite-manual-backup-'))
  const path = join(directory, 'test.sqlite')
  const storage = new MisHistoriasStorage(path)

  try {
    storage.put('characters', 'normal', 'normal-1', {
      ...character('normal-1'),
      name: 'Normal original'
    })
    storage.put('characters', 'private', 'private-1', {
      ...character('private-1'),
      name: 'Privado original'
    })
    storage.writeSettings({ theme: 'dark' })

    const backup = storage.createManualBackup()
    assert.equal(backup.kind, 'manual')
    assert.equal(backup.valid, true)
    assert.equal(backup.schemaVersion, 5)
    assert.equal(storage.listBackups().some((item) => item.name === backup.name), true)

    storage.put('characters', 'normal', 'normal-1', {
      ...character('normal-1'),
      name: 'Normal cambiado'
    })
    storage.delete('characters', 'private', 'private-1')
    storage.writeSettings({ theme: 'light' })

    const result = storage.restoreBackup(backup.name)
    assert.equal(result.restored.name, backup.name)
    assert.equal(result.safety.kind, 'before-restore')

    const restored = new MisHistoriasStorage(path)
    try {
      assert.equal(
        (restored.get('characters', 'normal', 'normal-1') as { name: string }).name,
        'Normal original'
      )
      assert.equal(
        (restored.get('characters', 'private', 'private-1') as { name: string }).name,
        'Privado original'
      )
      assert.equal(restored.readSettings()?.value.theme, 'dark')
      assert.equal(
        restored.listBackups().some((item) => item.name === result.safety.name),
        true
      )
    } finally {
      restored.close()
    }
  } finally {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('rechaza restaurar un backup desconocido sin crear copia de seguridad', () => {
  withStorage((storage) => {
    assert.throws(() => storage.restoreBackup('../otro.sqlite'), /Backup no encontrado/)
    assert.deepEqual(storage.listBackups(), [])
  })
})

test('muestra pero no restaura archivos SQLite vacíos', () => {
  withStorage((storage, path) => {
    const backupDirectory = join(dirname(path), 'backups')
    const backupPath = join(backupDirectory, 'test.manual-empty.sqlite')
    mkdirSync(backupDirectory)
    new DatabaseSync(backupPath).close()

    const backup = storage.listBackups()[0]
    assert.equal(backup?.name, 'test.manual-empty.sqlite')
    assert.equal(backup?.valid, false)
    assert.throws(
      () => storage.restoreBackup('test.manual-empty.sqlite'),
      /no es válido y no puede restaurarse/
    )
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

test('guarda sonidos asociados o sueltos y borra asociaciones en cascada', () => {
  withStorage((storage) => {
    storage.put('characters', 'normal', 'character-1', character('character-1'))
    storage.putBinary('sounds', 'normal', 'sound-character', {
      metadata: {
        id: 'sound-character',
        tags: ['voz'],
        characterId: 'character-1',
        backgroundId: null,
        mimeType: 'audio/ogg',
        createdAt: 1
      },
      data: new Uint8Array([1, 2, 3])
    })
    storage.putBinary('sounds', 'normal', 'sound-loose', {
      metadata: {
        id: 'sound-loose',
        tags: ['trueno'],
        characterId: null,
        backgroundId: null,
        mimeType: 'audio/mpeg',
        createdAt: 2
      },
      data: new Uint8Array([4, 5])
    })

    assert.equal(storage.list('sounds', 'normal').length, 2)
    assert.deepEqual(Array.from(storage.getBinary('sounds', 'normal', 'sound-loose')!.data), [4, 5])
    storage.delete('characters', 'normal', 'character-1')
    assert.deepEqual(storage.list('sounds', 'normal').map((sound) => sound.id), ['sound-loose'])
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
