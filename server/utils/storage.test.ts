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
import type { CharacterImage, SwarmPrompt } from '../../shared/types/index.ts'

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
    imageGenerationPreset: '',
    imageGenerationLora: '',
    imageGenerationSeed: '',
    imageGenerationPromptPrefix: '',
    archived: false,
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
      pendingImageInstructions: [
        { characterId: 'normal-1', imageId: 'image-1', tags: ['feliz'] }
      ],
      contextSummary: 'Resumen persistido.',
      contextSummaryThroughMessageId: 'message-1',
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
      useChromeLlm: true,
      privateUseChromeLlm: false,
      visualNovelManualAdvance: true,
      swarmBaseUrl: 'http://localhost:7801',
      swarmAuthToken: 'swarm-secreto'
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
      assert.deepEqual(reopened.get('stories', 'normal', 'story-normal')?.pendingImageInstructions, [
        { characterId: 'normal-1', imageId: 'image-1', tags: ['feliz'] }
      ])
      assert.equal(reopened.get('stories', 'normal', 'story-normal')?.contextSummary, 'Resumen persistido.')
      assert.equal(
        reopened.get('stories', 'normal', 'story-normal')?.contextSummaryThroughMessageId,
        'message-1'
      )
      assert.deepEqual(
        reopened.get('stories', 'private', 'story-private')?.characterCustomizations,
        [{ characterId: 'private-1', prompt: 'Prompt privado', tags: ['privado'] }]
      )
      assert.equal(reopened.readSettings()?.value.model, 'modelo')
      assert.equal(reopened.readSettings()?.value.useChromeLlm, true)
      assert.equal(reopened.readSettings()?.value.privateUseChromeLlm, false)
      assert.equal(reopened.readSettings()?.value.visualNovelManualAdvance, true)
      assert.equal(reopened.readSettings()?.apiKey, 'secreto')
      assert.equal(reopened.readSettings()?.swarmAuthToken, 'swarm-secreto')
      assert.equal(
        (reopened.get('stories', 'normal', 'story-normal') as { visualMode?: boolean } | null)
          ?.visualMode,
        true
      )
      assert.equal(reopened.health().schemaVersion, 28)
    } finally {
      reopened.close()
    }
  })
})

test('catálogo SwarmUI conserva orden, aísla ámbitos y limpia solo el indicado', () => {
  withStorage((storage) => {
    const prompt = { id: 'p', name: 'Pose', prompt: 'standing', tags: ['Feliz', 'feliz'], createdAt: 1, updatedAt: 1 }
    for (const scope of ['normal', 'private'] as const) storage.put('swarmPrompts', scope, 'p', prompt)
    storage.put('swarmPrompts', 'normal', 'second', { ...prompt, id: 'second', createdAt: 2 })
    storage.put('swarmPrompts', 'normal', 'p', { ...prompt, name: 'Editado', createdAt: 99 })
    assert.deepEqual(storage.list('swarmPrompts', 'normal').map((item) => item.id), ['p', 'second'])
    assert.equal((storage.get('swarmPrompts', 'private', 'p') as SwarmPrompt)?.name, 'Pose')
    assert.deepEqual((storage.get('swarmPrompts', 'normal', 'p') as SwarmPrompt)?.tags, ['Feliz'])
    storage.delete('swarmPrompts', 'normal', 'second')
    assert.throws(() => storage.put('swarmPrompts', 'normal', 'bad', { ...prompt, name: ' ' }))
    storage.clear('normal')
    assert.equal(storage.list('swarmPrompts', 'normal').length, 0)
    assert.equal(storage.list('swarmPrompts', 'private').length, 1)
  })
})

test('migra v27 y conserva semillas al recortar, copiar, restaurar e importar', () => {
  withStorage((storage, path) => {
    storage.put('characters', 'normal', 'c', character('c'))
    const metadata = { id: 'i', characterId: 'c', tags: ['feliz'], isDefault: true, mimeType: 'image/png', createdAt: 1 }
    storage.putBinary('images', 'normal', 'i', { metadata, data: new Uint8Array([1]) })
    storage.close()
    const legacy = new DatabaseSync(path)
    legacy.exec('DROP TABLE swarm_prompts; ALTER TABLE images DROP COLUMN generation_json; PRAGMA user_version = 27;')
    legacy.close()
    const migrated = new MisHistoriasStorage(path)
    try {
      assert.equal((migrated.get('images', 'normal', 'i') as CharacterImage)?.generation, undefined)
      assert.equal(migrated.list('swarmPrompts', 'normal').length, 0)
      assert.equal(migrationBackups(path).length, 1)
      const generation = { seed: 123, variationSeed: 456, variationSeedStrength: 0.5 }
      migrated.putBinary('images', 'normal', 'i', { metadata: { ...metadata, generation }, data: new Uint8Array([2]) })
      const copied = migrated.copyCharacter('normal', 'c', character('copy'))!
      assert.deepEqual((copied.images[0] as CharacterImage)?.generation, generation)
      migrated.restoreImage('normal', 'i')
      assert.deepEqual((migrated.get('images', 'normal', 'i') as CharacterImage)?.generation, generation)
      const imported = migrated.importCharacter('normal', null, { ...character('import'),
        images: [{ metadata: { ...metadata, generation }, data: new Uint8Array([3]) }], sounds: [] })!
      assert.deepEqual((imported.images[0] as CharacterImage)?.generation, generation)
    } finally { migrated.close() }
  })
})

test('migra v1 a v28 copiando personajes y dejando modo visual desactivado', () => {
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
    assert.equal(storage.health().schemaVersion, 28)
    assert.equal(storage.get('characters', 'normal', 'character-1')?.archived, false)
    assert.equal(
      (storage.get('stories', 'normal', 'story-1') as { visualMode?: boolean } | null)
        ?.visualMode,
      false
    )
    assert.deepEqual(storage.get('stories', 'normal', 'story-1')?.characterCustomizations, [
      {
        characterId: 'character-1',
        color: '#123456',
        prompt: 'Prompt original',
        tags: ['aventurera']
      }
    ])
  } finally {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('migra v5 añadiendo preset de personaje y secreto Swarm con backup previo', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-sqlite-v5-'))
  const path = join(directory, 'test.sqlite')
  const legacy = new DatabaseSync(path)
  legacy.exec(`
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
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT ''
    ) STRICT;
    INSERT INTO characters(
      scope, id, name, prompt, tags_json, color, created_at, updated_at
    ) VALUES ('normal', 'character-1', 'Alicia', 'Prompt', '[]', '#123456', 1, 2);
    INSERT INTO settings(key, value_json, api_key)
    VALUES ('app', '{"theme":"dark"}', 'llm-secret');
    PRAGMA user_version = 5;
  `)
  legacy.close()

  const storage = new MisHistoriasStorage(path)
  try {
    assert.equal(storage.health().schemaVersion, 28)
    assert.equal(storage.get('characters', 'normal', 'character-1')?.imageGenerationPreset, '')
    assert.equal(storage.get('characters', 'normal', 'character-1')?.imageGenerationLora, '')
    assert.equal(storage.get('characters', 'normal', 'character-1')?.imageGenerationSeed, '')
    assert.equal(storage.get('characters', 'normal', 'character-1')?.imageGenerationPromptPrefix, '')
    assert.equal(storage.readSettings()?.apiKey, 'llm-secret')
    assert.equal(storage.readSettings()?.swarmAuthToken, '')
    const backups = migrationBackups(path)
    assert.equal(backups.length, 1)
    const backup = new DatabaseSync(backups[0]!, { readOnly: true })
    try {
      assert.equal(
        (backup.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
        5
      )
      const oldCharacterColumns = backup.prepare('PRAGMA table_info(characters)').all() as Array<{
        name: string
      }>
      assert.equal(
        oldCharacterColumns.some((column) => column.name === 'image_generation_preset'),
        false
      )
    } finally {
      backup.close()
    }

    storage.writeSettings({ swarmBaseUrl: 'http://localhost:7801', swarmAuthToken: 'swarm-secret' })
    assert.equal(storage.readSettings()?.value.swarmBaseUrl, 'http://localhost:7801')
    assert.equal(storage.readSettings()?.swarmAuthToken, 'swarm-secret')
    assert.equal('swarmAuthToken' in (storage.readSettings()?.value ?? {}), false)
  } finally {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('migra v6 añadiendo indicaciones de imagen pendientes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-sqlite-v6-'))
  const path = join(directory, 'test.sqlite')
  const initial = new MisHistoriasStorage(path)
  initial.put('stories', 'normal', 'story-1', story('story-1'))
  initial.close()

  const legacy = new DatabaseSync(path)
  legacy.exec(`
    ALTER TABLE stories DROP COLUMN pending_image_instructions_json;
    PRAGMA user_version = 6;
  `)
  legacy.close()

  const storage = new MisHistoriasStorage(path)
  try {
    assert.equal(storage.health().schemaVersion, 28)
    assert.deepEqual(storage.get('stories', 'normal', 'story-1')?.pendingImageInstructions, [])
    assert.equal(migrationBackups(path).length, 1)
  } finally {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('migra v22 eliminando descripciones de imágenes en ambos ámbitos', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-sqlite-v22-'))
  const path = join(directory, 'test.sqlite')
  const initial = new MisHistoriasStorage(path)
  initial.put('characters', 'normal', 'normal-1', character('normal-1'))
  initial.put('characters', 'private', 'private-1', character('private-1'))
  initial.putBinary('images', 'normal', 'normal-image', {
    metadata: {
      characterId: 'normal-1',
      tags: ['neutral'],
      isDefault: true,
      mimeType: 'image/png',
      createdAt: 1
    },
    data: new Uint8Array([1])
  })
  initial.putBinary('images', 'private', 'private-image', {
    metadata: {
      characterId: 'private-1',
      tags: ['neutral'],
      isDefault: true,
      mimeType: 'image/png',
      createdAt: 1
    },
    data: new Uint8Array([2])
  })
  const legacyStory = {
    ...story('story-1'),
    imageCatalogSnapshot: [{
      imageId: 'normal-image',
      characterId: 'normal-1',
      characterName: 'Personaje normal-1',
      tags: ['neutral'],
      description: 'descripción antigua',
      isDefault: true
    }]
  }
  initial.put('stories', 'normal', 'story-1', legacyStory)
  initial.put('storySaves', 'normal', 'save-1', {
    id: 'save-1',
    storyId: 'story-1',
    name: 'Partida antigua',
    story: legacyStory,
    messages: [],
    debugTraces: [],
    thumbnailDataUrl: 'data:image/webp;base64,AA==',
    createdAt: 2
  })
  initial.close()

  const legacy = new DatabaseSync(path)
  legacy.exec(`
    ALTER TABLE images ADD COLUMN description TEXT NOT NULL DEFAULT '';
    UPDATE images SET description = 'descripción antigua';
    PRAGMA user_version = 22;
  `)
  legacy.close()

  const storage = new MisHistoriasStorage(path)
  try {
    assert.equal(storage.health().schemaVersion, 28)
    const columns = storage.database.prepare('PRAGMA table_info(images)').all() as Array<{
      name: string
    }>
    assert.equal(columns.some((column) => column.name === 'description'), false)
    assert.equal('description' in storage.get('images', 'normal', 'normal-image')!, false)
    assert.equal('description' in storage.get('images', 'private', 'private-image')!, false)
    assert.equal(
      'description' in storage.get('stories', 'normal', 'story-1')!.imageCatalogSnapshot![0]!,
      false
    )
    assert.equal(
      'description' in storage.get('storySaves', 'normal', 'save-1')!.story.imageCatalogSnapshot![0]!,
      false
    )
    const persisted = storage.database.prepare(`
      SELECT image_catalog_snapshot_json AS catalog FROM stories WHERE id = 'story-1'
    `).get() as { catalog: string }
    assert.equal(persisted.catalog.includes('description'), false)
    assert.equal(migrationBackups(path).length, 1)
  } finally {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('migra v23 copiando colores de personajes en historias y partidas', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-sqlite-v23-'))
  const path = join(directory, 'test.sqlite')
  const initial = new MisHistoriasStorage(path)
  const normalCharacter = character('shared-character')
  const privateCharacter = { ...character('shared-character'), color: '#abcdef' }
  const normalStory = {
    ...story('normal-story'),
    characterIds: [normalCharacter.id],
    characterCustomizations: [{
      characterId: normalCharacter.id,
      name: 'Nombre normal',
      prompt: normalCharacter.prompt,
      tags: normalCharacter.tags
    }]
  }
  const privateStory = {
    ...story('private-story'),
    characterIds: [privateCharacter.id],
    characterCustomizations: [{
      characterId: privateCharacter.id,
      name: 'Nombre privado',
      prompt: privateCharacter.prompt,
      tags: privateCharacter.tags
    }]
  }
  initial.put('characters', 'normal', normalCharacter.id, normalCharacter)
  initial.put('characters', 'private', privateCharacter.id, privateCharacter)
  initial.put('stories', 'normal', normalStory.id, normalStory)
  initial.put('stories', 'private', privateStory.id, privateStory)
  initial.put('storySaves', 'normal', 'save-v23', {
    id: 'save-v23',
    storyId: normalStory.id,
    name: 'Partida v23',
    story: normalStory,
    messages: [],
    debugTraces: [],
    thumbnailDataUrl: 'data:image/webp;base64,AA==',
    createdAt: 2
  })
  initial.close()

  const legacy = new DatabaseSync(path)
  legacy.exec('PRAGMA user_version = 23')
  legacy.close()

  const storage = new MisHistoriasStorage(path)
  try {
    assert.equal(storage.health().schemaVersion, 28)
    assert.equal(
      storage.get('stories', 'normal', normalStory.id)?.characterCustomizations[0]?.color,
      '#123456'
    )
    assert.equal(
      storage.get('stories', 'private', privateStory.id)?.characterCustomizations[0]?.color,
      '#abcdef'
    )
    assert.equal(
      storage.get('storySaves', 'normal', 'save-v23')?.story.characterCustomizations[0]?.color,
      '#123456'
    )
    assert.equal(migrationBackups(path).length, 1)
  } finally {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('migra v24 añadiendo semilla y prefijo de imagen en ambos ámbitos', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-sqlite-v24-'))
  const path = join(directory, 'test.sqlite')
  const initial = new MisHistoriasStorage(path)
  initial.put('characters', 'normal', 'normal-character', character('normal-character'))
  initial.put('characters', 'private', 'private-character', character('private-character'))
  initial.close()

  const legacy = new DatabaseSync(path)
  legacy.exec(`
    ALTER TABLE characters DROP COLUMN image_generation_seed;
    ALTER TABLE characters DROP COLUMN image_generation_prompt_prefix;
    PRAGMA user_version = 24;
  `)
  legacy.close()

  const storage = new MisHistoriasStorage(path)
  try {
    assert.equal(storage.health().schemaVersion, 28)
    for (const scope of ['normal', 'private'] as const) {
      const stored = storage.get('characters', scope, `${scope}-character`)
      assert.equal(stored?.imageGenerationSeed, '')
      assert.equal(stored?.imageGenerationPromptPrefix, '')
    }
    assert.equal(migrationBackups(path).length, 1)
  } finally {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('migra v25 añadiendo resumen de contexto a las historias', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-sqlite-v25-'))
  const path = join(directory, 'test.sqlite')
  const initial = new MisHistoriasStorage(path)
  initial.put('stories', 'normal', 'story-normal', story('story-normal'))
  initial.close()

  const legacy = new DatabaseSync(path)
  legacy.exec(`
    ALTER TABLE stories DROP COLUMN context_summary_through_message_id;
    ALTER TABLE stories DROP COLUMN context_summary;
    PRAGMA user_version = 25;
  `)
  legacy.close()

  const storage = new MisHistoriasStorage(path)
  try {
    assert.equal(storage.health().schemaVersion, 28)
    const stored = storage.get('stories', 'normal', 'story-normal')
    assert.equal(stored?.contextSummary, '')
    assert.equal(stored?.contextSummaryThroughMessageId, undefined)
    assert.equal(migrationBackups(path).length, 1)
  } finally {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('migra v19 y separa los ajustes privados de LMStudio', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-sqlite-v19-'))
  const path = join(directory, 'test.sqlite')
  const legacy = new DatabaseSync(path)
  legacy.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      swarm_auth_token TEXT NOT NULL DEFAULT ''
    ) STRICT;
    INSERT INTO settings(key, value_json, api_key, swarm_auth_token)
    VALUES (
      'app',
      '{"baseUrl":"http://normal.test","model":"normal-model","temperature":0.7,"maxTokens":900,"historyBudget":5000}',
      'normal-secret',
      ''
    );
    PRAGMA user_version = 19;
  `)
  legacy.close()

  const storage = new MisHistoriasStorage(path)
  try {
    assert.equal(storage.health().schemaVersion, 28)
    assert.equal(storage.readSettings()?.privateApiKey, '')

    storage.writeSettings({
      privateLlmSettingsEnabled: true,
      privateBaseUrl: 'http://normal.test',
      privateModel: 'normal-model',
      privateTemperature: 0.7,
      privateMaxTokens: 900,
      privateHistoryBudget: 5000
    })
    assert.equal(storage.readSettings()?.privateApiKey, 'normal-secret')

    storage.writeSettings({ privateApiKey: 'private-secret', privateModel: 'private-model' })
    assert.equal(storage.readSettings()?.privateApiKey, 'private-secret')
    assert.equal(storage.readSettings()?.value.privateModel, 'private-model')

    storage.writeSettings({ privateLlmSettingsEnabled: false, privateApiKey: '' })
    assert.equal(storage.readSettings()?.privateApiKey, '')
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
    assert.equal(storage.health().schemaVersion, 28)
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
      /Falló la migración SQLite v3 a v28\. Backup:/
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
      /No se pudo crear el backup previo de SQLite\. Migración v3 a v28 no iniciada\./
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
    assert.equal(backup.schemaVersion, 28)
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

test('persiste archivado y bloquea borrar personajes usados por historias del mismo ámbito', () => {
  withStorage((storage) => {
    storage.put('characters', 'normal', 'character-1', {
      ...character('character-1'),
      archived: true
    })
    storage.put('characters', 'private', 'character-1', character('character-1'))
    storage.put('stories', 'normal', 'story-1', {
      ...story('story-1'),
      title: 'Bosque secreto',
      characterIds: ['character-1']
    })

    assert.equal(storage.get('characters', 'normal', 'character-1')?.archived, true)
    assert.equal(storage.get('characters', 'private', 'character-1')?.archived, false)
    assert.throws(
      () => storage.delete('characters', 'normal', 'character-1'),
      (caught: unknown) => {
        const error = caught as {
          code?: string
          stories?: Array<{ id: string; title: string }>
        }
        assert.equal(error.code, 'ERR_CHARACTER_IN_USE')
        assert.deepEqual(error.stories, [{ id: 'story-1', title: 'Bosque secreto' }])
        return true
      }
    )

    storage.delete('characters', 'private', 'character-1')
    assert.equal(storage.get('characters', 'normal', 'character-1')?.id, 'character-1')
    storage.delete('stories', 'normal', 'story-1')
    storage.delete('characters', 'normal', 'character-1')
    assert.equal(storage.get('characters', 'normal', 'character-1'), null)
  })
})

test('copia personajes con preset, imágenes nuevas y BLOBs compartidos dentro del ámbito', () => {
  withStorage((storage) => {
    storage.put('characters', 'normal', 'source', {
      ...character('source'),
      imageGenerationPreset: 'Retrato cinematográfico',
      imageGenerationLora: 'Detalle cinematográfico',
      imageGenerationSeed: '9243353',
      imageGenerationPromptPrefix: 'masterpiece',
      archived: true
    })
    storage.put('characters', 'private', 'private-source', character('private-source'))
    storage.putBinary('images', 'normal', 'image-1', {
      metadata: {
        id: 'image-1',
        characterId: 'source',
        tags: ['neutral'],
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
    assert.equal(copied.character.imageGenerationPreset, 'Retrato cinematográfico')
    assert.equal(copied.character.imageGenerationLora, 'Detalle cinematográfico')
    assert.equal(copied.character.imageGenerationSeed, '9243353')
    assert.equal(copied.character.imageGenerationPromptPrefix, 'masterpiece')
    assert.equal(copied.character.archived, false)
    assert.deepEqual(copied.images.map((image) => image.tags), [['neutral'], ['feliz']])
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

test('conserva la primera original al recortar, copiar, reabrir y restaurar en cada ámbito', () => {
  withStorage((storage, path) => {
    const original = new Uint8Array([1, 2, 3])
    for (const scope of ['normal', 'private'] as const) {
      storage.put('characters', scope, 'crop-character', character('crop-character'))
      const metadata = {
        characterId: 'crop-character', tags: ['feliz'], isDefault: true,
        mimeType: 'image/png', createdAt: 5
      }
      storage.putBinary('images', scope, 'crop-image', { metadata, data: original })
      assert.equal(storage.getOriginalImage(scope, 'crop-image'), null)
      storage.putBinary('images', scope, 'crop-image', {
        metadata: { ...metadata, mimeType: 'image/webp' }, data: new Uint8Array([4, 5])
      })
      storage.putBinary('images', scope, 'crop-image', {
        metadata: { ...metadata, mimeType: 'image/webp' }, data: new Uint8Array([6]),
        original: { mimeType: 'image/webp', data: new Uint8Array([99]) }
      })
      assert.deepEqual(storage.getOriginalImage(scope, 'crop-image'), { data: original, mimeType: 'image/png' })
      assert.equal(storage.get('images', scope, 'crop-image')?.hasOriginal, true)
      const copied = storage.copyCharacter(scope, 'crop-character', character('copy'))!
      const copiedImage = copied.images[0]!
      storage.delete('characters', scope, 'crop-character')
      assert.deepEqual(storage.getOriginalImage(scope, String(copiedImage.id))?.data, original)
      storage.restoreImage(scope, String(copiedImage.id))
      assert.deepEqual(storage.getBinary('images', scope, String(copiedImage.id)), { data: original, mimeType: 'image/png' })
      assert.equal(storage.getOriginalImage(scope === 'normal' ? 'private' : 'normal', String(copiedImage.id)), null)
      storage.putBinary('images', scope, String(copiedImage.id), {
        metadata: copiedImage, data: new Uint8Array([7, 8])
      })
    }
    storage.close()
    const reopened = new MisHistoriasStorage(path)
    try {
      for (const scope of ['normal', 'private'] as const) {
        const image = reopened.list('images', scope)[0]!
        reopened.restoreImage(scope, String(image.id))
        assert.deepEqual(reopened.getBinary('images', scope, String(image.id))?.data, original)
        assert.deepEqual(reopened.getOriginalImage(scope, String(image.id))?.data, original)
      }
    } finally {
      reopened.close()
    }
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

test('guarda, carga y aísla partidas completas por ámbito', () => {
  withStorage((storage) => {
    storage.put('stories', 'normal', 'story-1', story('story-1'))
    storage.put('messages', 'normal', 'message-1', {
      id: 'message-1',
      storyId: 'story-1',
      role: 'assistant',
      raw: 'Progreso guardado',
      segments: [{ type: 'narration', characterId: null, tag: null, text: 'Escena' }],
      createdAt: 10
    })
    storage.put('llmDebugTraces', 'normal', 'trace-1', {
      id: 'trace-1',
      storyId: 'story-1',
      responseMessageId: 'message-1',
      status: 'success',
      request: { model: 'modelo', messages: [], temperature: 0.8, max_tokens: 100, stream: false },
      response: { content: 'Progreso guardado', finishReason: null },
      createdAt: 11
    })

    const first = storage.createStorySave(
      'normal',
      'story-1',
      '24/8/2026, 20:00:00',
      'data:image/webp;base64,UklGRg=='
    )
    const second = storage.createStorySave(
      'normal',
      'story-1',
      '24/8/2026, 20:00:00',
      'data:image/webp;base64,UklGRg=='
    )
    assert.ok(first)
    assert.ok(second)
    assert.notEqual(first.id, second.id)
    assert.equal(first.debugTraces.length, 1)

    storage.put('stories', 'normal', 'story-1', { ...story('story-1'), title: 'Cambiada' })
    storage.deleteMessages('normal', ['message-1'])
    storage.put('messages', 'normal', 'message-2', {
      id: 'message-2', storyId: 'story-1', role: 'user', raw: 'Rama nueva', segments: [], createdAt: 20
    })
    assert.ok(storage.loadStorySave('normal', first.id))
    assert.equal(storage.get('stories', 'normal', 'story-1')?.title, 'Historia story-1')
    assert.deepEqual(
      storage.list('messages', 'normal', { storyId: 'story-1' }).map((message) => message.id),
      ['message-1']
    )
    assert.deepEqual(
      storage.list('llmDebugTraces', 'normal', { storyId: 'story-1' }).map((trace) => trace.id),
      ['trace-1']
    )
    assert.equal(storage.list('storySaves', 'normal', { storyId: 'story-1' }).length, 2)
    assert.equal(storage.list('storySaves', 'private', { storyId: 'story-1' }).length, 0)

    storage.delete('stories', 'normal', 'story-1')
    assert.equal(storage.list('storySaves', 'normal', { storyId: 'story-1' }).length, 0)
  })
})

test('importa personaje nuevo con medios e IDs nuevos', () => {
  withStorage((storage) => {
    storage.putBinary('sounds', 'normal', 'existing-sound', {
      metadata: {
        tags: ['saludo'],
        characterId: null,
        backgroundId: null,
        mimeType: 'audio/ogg',
        createdAt: 1
      },
      data: new Uint8Array([9])
    })
    const imported = storage.importCharacter('normal', null, {
      name: 'Importada',
      prompt: 'Prompt importado',
      tags: ['valiente'],
      color: '#abcdef',
      imageGenerationPreset: 'Retrato',
      imageGenerationLora: 'Detalle',
      imageGenerationSeed: '12345',
      imageGenerationPromptPrefix: 'detailed portrait',
      images: [{
        metadata: {
          tags: ['feliz'],
          isDefault: true,
          mimeType: 'image/png'
        },
        data: new Uint8Array([1, 2, 3])
      }],
      sounds: [{
        metadata: { tags: ['saludo'], mimeType: 'audio/ogg' },
        data: new Uint8Array([4, 5])
      }]
    })!

    assert.equal(imported.character.name, 'Importada')
    assert.equal(imported.images.length, 1)
    assert.notEqual(imported.images[0]!.id, 'image-exported')
    assert.deepEqual(imported.sounds[0]!.tags, ['saludo-2'])
    assert.deepEqual(
      Array.from(storage.getBinary('images', 'normal', imported.images[0]!.id)!.data),
      [1, 2, 3]
    )
  })
})

test('reemplaza personaje de forma atómica conservando su ID e historias', () => {
  withStorage((storage) => {
    storage.put('characters', 'normal', 'target', {
      ...character('target'),
      archived: true
    })
    storage.put('stories', 'normal', 'story-target', {
      ...story('story-target'),
      characterIds: ['target'],
      characterCustomizations: [{ characterId: 'target', prompt: 'Anterior', tags: ['antes'] }]
    })
    storage.putBinary('images', 'normal', 'old-image', {
      metadata: {
        tags: ['antes'], isDefault: true, characterId: 'target',
        mimeType: 'image/png', createdAt: 1
      },
      data: new Uint8Array([8])
    })
    storage.putBinary('sounds', 'normal', 'old-sound', {
      metadata: {
        tags: ['voz'], characterId: 'target', backgroundId: null,
        mimeType: 'audio/ogg', createdAt: 1
      },
      data: new Uint8Array([7])
    })

    const imported = storage.importCharacter('normal', 'target', {
      name: 'Nuevo nombre',
      prompt: 'Nuevo prompt',
      tags: ['después'],
      color: '#ffffff',
      imageGenerationPreset: '',
      imageGenerationLora: '',
      imageGenerationSeed: '',
      imageGenerationPromptPrefix: '',
      images: [{
        metadata: {
          tags: ['después'], isDefault: true, mimeType: 'image/webp'
        },
        data: new Uint8Array([1])
      }],
      sounds: [{
        metadata: { tags: ['nueva-voz'], mimeType: 'audio/ogg' },
        data: new Uint8Array([2])
      }]
    })!

    assert.equal(imported.character.id, 'target')
    assert.equal(imported.character.archived, true)
    assert.equal(storage.get('images', 'normal', 'old-image'), null)
    assert.equal(storage.get('sounds', 'normal', 'old-sound'), null)
    assert.deepEqual(storage.get('stories', 'normal', 'story-target')?.characterIds, ['target'])

    assert.throws(() => storage.importCharacter('normal', 'target', {
      name: 'Fallará',
      prompt: '',
      tags: [],
      color: '#000000',
      imageGenerationPreset: '',
      imageGenerationLora: '',
      imageGenerationSeed: '',
      imageGenerationPromptPrefix: '',
      images: [1, 2].map(() => ({
        metadata: { tags: [], isDefault: true, mimeType: 'image/png' },
        data: new Uint8Array([3])
      })),
      sounds: []
    }))
    assert.equal(storage.get('characters', 'normal', 'target')?.name, 'Nuevo nombre')
    assert.equal(storage.list('images', 'normal', { characterId: 'target' }).length, 1)
    assert.equal(storage.list('sounds', 'normal').filter((item) => item.characterId === 'target').length, 1)
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
