import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { readImageGeneration } from '../../shared/utils/imageGeneration.ts'
import type {
  DatabaseBackup,
  DatabaseBackupKind,
  LlmDebugTrace,
  Message,
  Story,
  StorySaveSlot
} from '../../shared/types/index.ts'

export type DataScope = 'normal' | 'private'
export type DataResource =
  | 'characters'
  | 'images'
  | 'backgrounds'
  | 'sounds'
  | 'stories'
  | 'messages'
  | 'llmDebugTraces'
  | 'storySaves'
  | 'presets'
  | 'swarmPrompts'

interface DataRecordMap {
  characters: ReturnType<typeof rowToCharacter>
  images: ReturnType<typeof rowToImage>
  backgrounds: ReturnType<typeof rowToBackground>
  sounds: ReturnType<typeof rowToSound>
  stories: ReturnType<typeof rowToStory>
  messages: ReturnType<typeof rowToMessage>
  llmDebugTraces: ReturnType<typeof rowToTrace>
  storySaves: ReturnType<typeof rowToStorySave>
  presets: ReturnType<typeof rowToPreset>
  swarmPrompts: ReturnType<typeof rowToSwarmPrompt>
}

type JsonResource = Exclude<DataResource, 'images' | 'backgrounds' | 'sounds'>

export interface ResourceQuery {
  storyId?: string
  characterId?: string
}

export interface BinaryPayload {
  metadata: Record<string, unknown>
  data: Uint8Array
  original?: { mimeType: string; data: Uint8Array }
}

export interface CharacterImportPayload {
  name: string
  prompt: string
  tags: string[]
  color: string
  imageGenerationPreset: string
  imageGenerationLora: string
  imageGenerationSeed: string
  imageGenerationPromptPrefix: string
  images: BinaryPayload[]
  sounds: BinaryPayload[]
}

interface SettingsRow {
  value: Record<string, unknown>
  apiKey: string
  privateApiKey: string
  swarmAuthToken: string
}

interface SqliteRow extends Record<string, unknown> {
  id: string
  scope: DataScope
}

const SCHEMA_VERSION = 28
const DEFAULT_DATABASE_PATH = '.data/mishistorias.sqlite'
const MIGRATION_BACKUP_RETENTION = 5

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function json(value: unknown) {
  return JSON.stringify(value ?? null)
}

function bool(value: unknown) {
  return value ? 1 : 0
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function integer(value: unknown, fallback = 0) {
  return Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback
}

function sameBinary(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function tags(value: unknown) {
  const seen = new Set<string>()
  return stringArray(value).flatMap((item) => {
    const tag = item.trim()
    const key = tag.toLocaleLowerCase()
    if (!key || seen.has(key)) return []
    seen.add(key)
    return [tag]
  })
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function imageCatalogSnapshot(value: unknown) {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((item) => {
    const entry = record(item)
    if (
      typeof entry.imageId !== 'string' ||
      typeof entry.characterId !== 'string' ||
      typeof entry.characterName !== 'string'
    ) return []
    return [{
      imageId: entry.imageId,
      characterId: entry.characterId,
      characterName: entry.characterName,
      tags: tags(entry.tags),
      isDefault: Boolean(entry.isDefault)
    }]
  })
}

function storyWithoutImageDescriptions(value: unknown) {
  const story = record(value)
  if (!Array.isArray(story.imageCatalogSnapshot)) return story
  return { ...story, imageCatalogSnapshot: imageCatalogSnapshot(story.imageCatalogSnapshot) }
}

function storyWithCharacterColors(
  value: unknown,
  colorFor: (characterId: string) => string | undefined
) {
  const story = record(value)
  if (!Array.isArray(story.characterCustomizations)) return story
  return {
    ...story,
    characterCustomizations: story.characterCustomizations.map((item) => {
      const customization = record(item)
      if (typeof customization.characterId !== 'string') return item
      const stored = typeof customization.color === 'string' ? customization.color.trim() : ''
      const fallback = colorFor(customization.characterId)?.trim() ?? ''
      const color = /^#[0-9a-f]{6}$/i.test(stored)
        ? stored.toLowerCase()
        : /^#[0-9a-f]{6}$/i.test(fallback)
          ? fallback.toLowerCase()
          : ''
      return color ? { ...customization, color } : customization
    })
  }
}

function rowToCharacter(row: SqliteRow) {
  return {
    id: row.id,
    name: text(row.name),
    prompt: text(row.prompt),
    tags: parseJson<string[]>(row.tags_json, []),
    color: text(row.color),
    imageGenerationPreset: text(row.image_generation_preset),
    imageGenerationLora: text(row.image_generation_lora),
    imageGenerationSeed: text(row.image_generation_seed),
    imageGenerationPromptPrefix: text(row.image_generation_prompt_prefix),
    archived: integer(row.archived) === 1,
    createdAt: integer(row.created_at),
    updatedAt: integer(row.updated_at)
  }
}

function rowToSwarmPrompt(row: SqliteRow) {
  return {
    id: row.id,
    name: text(row.name),
    prompt: text(row.prompt),
    tags: parseJson<string[]>(row.tags_json, []),
    createdAt: integer(row.created_at),
    updatedAt: integer(row.updated_at)
  }
}

function rowToImage(row: SqliteRow) {
  return {
    id: row.id,
    characterId: text(row.character_id),
    tags: parseJson<string[]>(row.tags_json, []),
    isDefault: Boolean(row.is_default),
    mimeType: text(row.mime_type, 'application/octet-stream'),
    createdAt: integer(row.created_at),
    hasOriginal: Boolean(row.has_original ?? row.original_data),
    generation: readImageGeneration(parseJson(row.generation_json, undefined))
  }
}

function rowToBackground(row: SqliteRow) {
  return {
    id: row.id,
    tags: parseJson<string[]>(row.tags_json, []),
    description: text(row.description),
    mimeType: text(row.mime_type, 'application/octet-stream'),
    createdAt: integer(row.created_at)
  }
}

function tagKey(value: string) {
  return value.trim().toLocaleLowerCase()
}

function nextAvailableTag(base: string, used: Set<string>) {
  let candidate = base
  let suffix = 2
  while (used.has(tagKey(candidate))) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

function rowToSound(row: SqliteRow) {
  return {
    id: row.id,
    tags: parseJson<string[]>(row.tags_json, []),
    characterId: typeof row.character_id === 'string' ? row.character_id : null,
    backgroundId: typeof row.background_id === 'string' ? row.background_id : null,
    mimeType: text(row.mime_type, 'application/octet-stream'),
    createdAt: integer(row.created_at)
  }
}

function rowToStory(row: SqliteRow) {
  return {
    id: row.id,
    title: text(row.title),
    premise: text(row.premise),
    visualMode: row.visual_mode === 1,
    protagonistPreferences: text(row.protagonist_preferences),
    protagonistPreferencesMode:
      row.protagonist_preferences_mode === 'replace' ? 'replace' : 'append',
    characterIds: parseJson<string[]>(row.character_ids_json, []),
    characterCustomizations: parseJson<Story['characterCustomizations']>(row.character_customizations_json, []),
    initialBackgroundId:
      typeof row.initial_background_id === 'string' ? row.initial_background_id : null,
    presetId: typeof row.preset_id === 'string' ? row.preset_id : null,
    imageCatalogSnapshot:
      row.image_catalog_snapshot_json === null
        ? undefined
        : imageCatalogSnapshot(parseJson(row.image_catalog_snapshot_json, undefined)),
    pendingImageInstructions: parseJson(row.pending_image_instructions_json, []),
    contextSummary: text(row.context_summary),
    ...(typeof row.context_summary_through_message_id === 'string'
      ? { contextSummaryThroughMessageId: row.context_summary_through_message_id }
      : {}),
    createdAt: integer(row.created_at),
    updatedAt: integer(row.updated_at)
  }
}

function rowToMessage(row: SqliteRow) {
  return {
    id: row.id,
    storyId: text(row.story_id),
    role: row.role === 'assistant' ? 'assistant' : 'user',
    raw: text(row.raw),
    segments: parseJson<unknown[]>(row.segments_json, []),
    createdAt: integer(row.created_at)
  }
}

function rowToTrace(row: SqliteRow) {
  return {
    id: row.id,
    storyId: text(row.story_id),
    ...(typeof row.request_message_id === 'string'
      ? { requestMessageId: row.request_message_id }
      : {}),
    ...(typeof row.response_message_id === 'string'
      ? { responseMessageId: row.response_message_id }
      : {}),
    status: row.status === 'error' ? 'error' : 'success',
    request: parseJson(row.request_json, {}),
    response: parseJson(row.response_json, {}),
    createdAt: integer(row.created_at)
  }
}

function rowToStorySave(row: SqliteRow) {
  return {
    id: row.id,
    storyId: text(row.story_id),
    name: text(row.name),
    story: storyWithoutImageDescriptions(parseJson(row.story_json, {})),
    messages: parseJson(row.messages_json, []),
    debugTraces: parseJson(row.debug_traces_json, []),
    thumbnailDataUrl: text(row.thumbnail_data_url),
    createdAt: integer(row.created_at)
  }
}

function rowToPreset(row: SqliteRow) {
  return {
    id: row.id,
    name: text(row.name),
    content: text(row.content),
    createdAt: integer(row.created_at),
    updatedAt: integer(row.updated_at)
  }
}

export function resolveDatabasePath(rawPath = process.env.NUXT_SQLITE_PATH) {
  const configured = rawPath?.trim() || DEFAULT_DATABASE_PATH
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured)
}

export class MisHistoriasStorage {
  readonly database: DatabaseSync
  readonly path: string

  constructor(path = resolveDatabasePath()) {
    this.path = path
    const databaseExisted = existsSync(path)
    mkdirSync(dirname(path), { recursive: true })
    this.database = new DatabaseSync(path, { timeout: 5000 })
    try {
      this.database.exec('PRAGMA foreign_keys = ON')
      this.database.exec('PRAGMA journal_mode = WAL')
      this.database.exec('PRAGMA synchronous = FULL')
      this.database.exec('PRAGMA busy_timeout = 5000')
      this.migrate(databaseExisted)
    } catch (caught) {
      this.close()
      throw caught
    }
  }

  private hasExistingSchema() {
    const row = this.database
      .prepare("SELECT COUNT(*) AS total FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")
      .get() as { total: number }
    return row.total > 0
  }

  private backupDirectory() {
    return join(dirname(this.path), 'backups')
  }

  private databaseName() {
    return parse(basename(this.path)).name
  }

  private nextBackupPath(label: string) {
    const backupDirectory = this.backupDirectory()
    const databaseName = this.databaseName()
    const timestamp = new Date().toISOString().replace(/[-:.]/g, '')
    const stem = `${databaseName}.${label}-${timestamp}`
    let backupPath = join(backupDirectory, `${stem}.sqlite`)
    let collision = 1
    while (existsSync(backupPath)) {
      backupPath = join(backupDirectory, `${stem}-${collision}.sqlite`)
      collision += 1
    }
    return { backupDirectory, backupPath, databaseName }
  }

  private readBackupVersion(path: string) {
    let backupDatabase: DatabaseSync | undefined
    try {
      backupDatabase = new DatabaseSync(path, { readOnly: true })
      const quickCheck = backupDatabase.prepare('PRAGMA quick_check').all() as Array<{
        quick_check: string
      }>
      const version = backupDatabase.prepare('PRAGMA user_version').get() as {
        user_version: number
      }
      const schema = backupDatabase
        .prepare("SELECT COUNT(*) AS total FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")
        .get() as { total: number }
      const schemaVersion = version.user_version
      return {
        valid:
          quickCheck.length === 1 &&
          quickCheck[0]?.quick_check === 'ok' &&
          schema.total > 0 &&
          Number.isInteger(schemaVersion) &&
          schemaVersion >= 0 &&
          schemaVersion <= SCHEMA_VERSION,
        schemaVersion
      }
    } catch {
      return { valid: false, schemaVersion: null }
    } finally {
      if (backupDatabase?.isOpen) backupDatabase.close()
    }
  }

  private backupKind(name: string): DatabaseBackupKind {
    if (name.startsWith(`${this.databaseName()}.manual-`)) return 'manual'
    if (name.startsWith(`${this.databaseName()}.before-restore-`)) return 'before-restore'
    return 'migration'
  }

  private inspectBackup(name: string, path: string): DatabaseBackup {
    const stats = statSync(path)
    const validation = this.readBackupVersion(path)
    return {
      name,
      kind: this.backupKind(name),
      createdAt: stats.mtime.toISOString(),
      size: stats.size,
      ...validation
    }
  }

  listBackups() {
    const backupDirectory = this.backupDirectory()
    if (!existsSync(backupDirectory)) return []
    const prefix = `${this.databaseName()}.`
    return readdirSync(backupDirectory, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          !entry.isSymbolicLink() &&
          entry.name.startsWith(prefix) &&
          entry.name.endsWith('.sqlite')
      )
      .map((entry) => {
        const path = join(backupDirectory, entry.name)
        return this.inspectBackup(entry.name, path)
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  private pruneMigrationBackups(backupDirectory: string, databaseName: string) {
    const prefix = `${databaseName}.from-v`
    const backups = readdirSync(backupDirectory, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          !entry.isSymbolicLink() &&
          entry.name.startsWith(prefix) &&
          entry.name.endsWith('.sqlite')
      )
      .map((entry) => {
        const path = join(backupDirectory, entry.name)
        return { path, modifiedAt: statSync(path).mtimeMs }
      })
      .sort((left, right) => right.modifiedAt - left.modifiedAt)

    for (const backup of backups.slice(MIGRATION_BACKUP_RETENTION)) {
      rmSync(backup.path, { force: true })
    }
  }

  private createBackup(label: string, expectedVersion: number) {
    const { backupPath } = this.nextBackupPath(label)
    const temporaryPath = `${backupPath}.tmp-${randomUUID()}`
    mkdirSync(this.backupDirectory(), { recursive: true })

    try {
      this.database.prepare('VACUUM INTO ?').run(temporaryPath)
      const validation = this.readBackupVersion(temporaryPath)
      if (!validation.valid || validation.schemaVersion !== expectedVersion) {
        throw new Error('La copia SQLite no superó la validación')
      }
      renameSync(temporaryPath, backupPath)
      return {
        path: backupPath,
        backup: this.inspectBackup(basename(backupPath), backupPath)
      }
    } catch (caught) {
      rmSync(temporaryPath, { force: true })
      throw caught
    }
  }

  private createMigrationBackup(fromVersion: number) {
    const created = this.createBackup(
      `from-v${fromVersion}-to-v${SCHEMA_VERSION}`,
      fromVersion
    )
    this.pruneMigrationBackups(this.backupDirectory(), this.databaseName())
    return created.path
  }

  createManualBackup() {
    const version = this.database.prepare('PRAGMA user_version').get() as { user_version: number }
    return this.createBackup('manual', version.user_version).backup
  }

  restoreBackup(name: string) {
    const backup = this.listBackups().find((item) => item.name === name)
    if (!backup) throw new Error('Backup no encontrado')
    if (!backup.valid || backup.schemaVersion === null) {
      throw new Error('El backup no es válido y no puede restaurarse')
    }

    const sourcePath = join(this.backupDirectory(), backup.name)
    const currentVersion = this.database.prepare('PRAGMA user_version').get() as {
      user_version: number
    }
    const safety = this.createBackup('before-restore', currentVersion.user_version).backup
    const temporaryPath = `${this.path}.restore-${randomUUID()}.tmp`
    const previousPath = `${this.path}.restore-${randomUUID()}.previous`

    try {
      copyFileSync(sourcePath, temporaryPath)
      const validation = this.readBackupVersion(temporaryPath)
      if (!validation.valid || validation.schemaVersion !== backup.schemaVersion) {
        throw new Error('La copia seleccionada no superó la validación final')
      }

      this.close()
      rmSync(`${this.path}-wal`, { force: true })
      rmSync(`${this.path}-shm`, { force: true })
      renameSync(this.path, previousPath)
      try {
        renameSync(temporaryPath, this.path)
      } catch (caught) {
        renameSync(previousPath, this.path)
        throw caught
      }
      rmSync(previousPath, { force: true })
      return { restored: backup, safety }
    } catch (caught) {
      rmSync(temporaryPath, { force: true })
      if (existsSync(previousPath)) {
        rmSync(this.path, { force: true })
        renameSync(previousPath, this.path)
      }
      throw caught
    }
  }

  private migrate(databaseExisted: boolean) {
    const version = this.database.prepare('PRAGMA user_version').get() as { user_version: number }
    if (version.user_version >= SCHEMA_VERSION) return

    let backupPath: string | null = null
    if (databaseExisted && this.hasExistingSchema()) {
      try {
        backupPath = this.createMigrationBackup(version.user_version)
      } catch (caught) {
        throw new Error(
          `No se pudo crear el backup previo de SQLite. Migración v${version.user_version} a v${SCHEMA_VERSION} no iniciada.`,
          { cause: caught }
        )
      }
    }

    try {
      this.transaction(() => {
        this.database.exec(`
        CREATE TABLE IF NOT EXISTS characters (
          scope TEXT NOT NULL CHECK (scope IN ('normal', 'private')),
          id TEXT NOT NULL,
          name TEXT NOT NULL,
          prompt TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          color TEXT NOT NULL,
          image_generation_preset TEXT NOT NULL DEFAULT '',
          image_generation_lora TEXT NOT NULL DEFAULT '',
          image_generation_seed TEXT NOT NULL DEFAULT '',
          image_generation_prompt_prefix TEXT NOT NULL DEFAULT '',
          archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (scope, id)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS image_blobs (
          scope TEXT NOT NULL CHECK (scope IN ('normal', 'private')),
          id TEXT NOT NULL,
          data BLOB NOT NULL,
          PRIMARY KEY (scope, id)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS images (
          scope TEXT NOT NULL CHECK (scope IN ('normal', 'private')),
          id TEXT NOT NULL,
          character_id TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
          mime_type TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          blob_id TEXT NOT NULL,
          PRIMARY KEY (scope, id),
          FOREIGN KEY (scope, character_id) REFERENCES characters(scope, id) ON DELETE CASCADE,
          FOREIGN KEY (scope, blob_id) REFERENCES image_blobs(scope, id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS images_by_character
          ON images(scope, character_id, created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS images_one_default
          ON images(scope, character_id) WHERE is_default = 1;

        CREATE TABLE IF NOT EXISTS backgrounds (
          scope TEXT NOT NULL CHECK (scope IN ('normal', 'private')),
          id TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          description TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          data BLOB NOT NULL,
          PRIMARY KEY (scope, id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS backgrounds_by_created_at
          ON backgrounds(scope, created_at);

        CREATE TABLE IF NOT EXISTS sounds (
          scope TEXT NOT NULL CHECK (scope IN ('normal', 'private')),
          id TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          character_id TEXT,
          background_id TEXT,
          mime_type TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          data BLOB NOT NULL,
          PRIMARY KEY (scope, id),
          CHECK (character_id IS NULL OR background_id IS NULL),
          FOREIGN KEY (scope, character_id) REFERENCES characters(scope, id) ON DELETE CASCADE,
          FOREIGN KEY (scope, background_id) REFERENCES backgrounds(scope, id) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX IF NOT EXISTS sounds_by_character
          ON sounds(scope, character_id, created_at);
        CREATE INDEX IF NOT EXISTS sounds_by_background
          ON sounds(scope, background_id, created_at);

        CREATE TABLE IF NOT EXISTS stories (
          scope TEXT NOT NULL CHECK (scope IN ('normal', 'private')),
          id TEXT NOT NULL,
          title TEXT NOT NULL,
          premise TEXT NOT NULL,
          visual_mode INTEGER NOT NULL DEFAULT 0 CHECK (visual_mode IN (0, 1)),
          protagonist_preferences TEXT NOT NULL,
          protagonist_preferences_mode TEXT NOT NULL CHECK (protagonist_preferences_mode IN ('append', 'replace')),
          character_ids_json TEXT NOT NULL,
          character_customizations_json TEXT NOT NULL,
          initial_background_id TEXT,
          preset_id TEXT,
          image_catalog_snapshot_json TEXT,
          pending_image_instructions_json TEXT NOT NULL DEFAULT '[]',
          context_summary TEXT NOT NULL DEFAULT '',
          context_summary_through_message_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (scope, id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS stories_by_updated_at
          ON stories(scope, updated_at DESC);

        CREATE TABLE IF NOT EXISTS messages (
          scope TEXT NOT NULL CHECK (scope IN ('normal', 'private')),
          id TEXT NOT NULL,
          story_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          raw TEXT NOT NULL,
          segments_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (scope, id),
          FOREIGN KEY (scope, story_id) REFERENCES stories(scope, id) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX IF NOT EXISTS messages_by_story
          ON messages(scope, story_id, created_at);

        CREATE TABLE IF NOT EXISTS llm_debug_traces (
          scope TEXT NOT NULL CHECK (scope IN ('normal', 'private')),
          id TEXT NOT NULL,
          story_id TEXT NOT NULL,
          request_message_id TEXT,
          response_message_id TEXT,
          status TEXT NOT NULL CHECK (status IN ('success', 'error')),
          request_json TEXT NOT NULL,
          response_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (scope, id),
          FOREIGN KEY (scope, story_id) REFERENCES stories(scope, id) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX IF NOT EXISTS traces_by_story
          ON llm_debug_traces(scope, story_id, created_at);
        CREATE INDEX IF NOT EXISTS traces_by_request_message
          ON llm_debug_traces(scope, request_message_id);
        CREATE INDEX IF NOT EXISTS traces_by_response_message
          ON llm_debug_traces(scope, response_message_id);

        CREATE TABLE IF NOT EXISTS story_saves (
          scope TEXT NOT NULL CHECK (scope IN ('normal', 'private')),
          id TEXT NOT NULL,
          story_id TEXT NOT NULL,
          name TEXT NOT NULL,
          story_json TEXT NOT NULL,
          messages_json TEXT NOT NULL,
          debug_traces_json TEXT NOT NULL,
          thumbnail_data_url TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (scope, id),
          FOREIGN KEY (scope, story_id) REFERENCES stories(scope, id) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX IF NOT EXISTS story_saves_by_story
          ON story_saves(scope, story_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS presets (
          scope TEXT NOT NULL CHECK (scope IN ('normal', 'private')),
          id TEXT NOT NULL,
          name TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (scope, id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS presets_by_created_at
          ON presets(scope, created_at);

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          api_key TEXT NOT NULL DEFAULT '',
          private_api_key TEXT NOT NULL DEFAULT '',
          swarm_auth_token TEXT NOT NULL DEFAULT ''
        ) STRICT;
      `)

      if (version.user_version < 2) {
        const columns = this.database.prepare('PRAGMA table_info(stories)').all() as Array<{
          name: string
        }>
        if (!columns.some((column) => column.name === 'character_customizations_json')) {
          this.database.exec(
            "ALTER TABLE stories ADD COLUMN character_customizations_json TEXT NOT NULL DEFAULT '[]'"
          )
        }

        const stories = this.database
          .prepare('SELECT scope, id, character_ids_json FROM stories')
          .all() as Array<{ scope: string; id: string; character_ids_json: string }>
        const characterStatement = this.database.prepare(
          'SELECT id, prompt, tags_json FROM characters WHERE scope = ? AND id = ?'
        )
        const updateStatement = this.database.prepare(
          'UPDATE stories SET character_customizations_json = ? WHERE scope = ? AND id = ?'
        )
        for (const story of stories) {
          const characterIds = parseJson<string[]>(story.character_ids_json, [])
          const customizations = characterIds.flatMap((characterId) => {
            const character = characterStatement.get(story.scope, characterId) as
              | { id: string; prompt: string; tags_json: string }
              | undefined
            return character
              ? [
                  {
                    characterId: character.id,
                    prompt: text(character.prompt),
                    tags: parseJson<string[]>(character.tags_json, [])
                  }
                ]
              : []
          })
          updateStatement.run(json(customizations), story.scope, story.id)
        }
      }

      if (version.user_version < 3) {
        const columns = this.database.prepare('PRAGMA table_info(stories)').all() as Array<{
          name: string
        }>
        if (!columns.some((column) => column.name === 'visual_mode')) {
          this.database.exec(
            'ALTER TABLE stories ADD COLUMN visual_mode INTEGER NOT NULL DEFAULT 0 CHECK (visual_mode IN (0, 1))'
          )
        }
      }

      if (version.user_version < 4) {
        const imageColumns = this.database.prepare('PRAGMA table_info(images)').all() as Array<{
          name: string
        }>
        if (imageColumns.some((column) => column.name === 'data')) {
          this.database.exec(`
            INSERT INTO image_blobs(scope, id, data)
            SELECT scope, id, data FROM images;

            CREATE TABLE images_v4 (
              scope TEXT NOT NULL CHECK (scope IN ('normal', 'private')),
              id TEXT NOT NULL,
              character_id TEXT NOT NULL,
              tags_json TEXT NOT NULL,
              description TEXT NOT NULL,
              is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
              mime_type TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              blob_id TEXT NOT NULL,
              PRIMARY KEY (scope, id),
              FOREIGN KEY (scope, character_id) REFERENCES characters(scope, id) ON DELETE CASCADE,
              FOREIGN KEY (scope, blob_id) REFERENCES image_blobs(scope, id)
            ) STRICT;

            INSERT INTO images_v4(
              scope, id, character_id, tags_json, description, is_default,
              mime_type, created_at, blob_id
            )
            SELECT
              scope, id, character_id, tags_json, description, is_default,
              mime_type, created_at, id
            FROM images;

            DROP TABLE images;
            ALTER TABLE images_v4 RENAME TO images;
            CREATE INDEX images_by_character ON images(scope, character_id, created_at);
            CREATE UNIQUE INDEX images_one_default
              ON images(scope, character_id) WHERE is_default = 1;
          `)
        }
      }

      if (version.user_version < 6) {
        const characterColumns = this.database
          .prepare('PRAGMA table_info(characters)')
          .all() as Array<{ name: string }>
        if (!characterColumns.some((column) => column.name === 'image_generation_preset')) {
          this.database.exec(
            "ALTER TABLE characters ADD COLUMN image_generation_preset TEXT NOT NULL DEFAULT ''"
          )
        }
        const settingsColumns = this.database
          .prepare('PRAGMA table_info(settings)')
          .all() as Array<{ name: string }>
        if (!settingsColumns.some((column) => column.name === 'swarm_auth_token')) {
          this.database.exec(
            "ALTER TABLE settings ADD COLUMN swarm_auth_token TEXT NOT NULL DEFAULT ''"
          )
        }
      }

      if (version.user_version < 7) {
        const storyColumns = this.database
          .prepare('PRAGMA table_info(stories)')
          .all() as Array<{ name: string }>
        if (!storyColumns.some((column) => column.name === 'pending_image_instructions_json')) {
          this.database.exec(
            "ALTER TABLE stories ADD COLUMN pending_image_instructions_json TEXT NOT NULL DEFAULT '[]'"
          )
        }
      }

      if (version.user_version < 19) {
        const characterColumns = this.database
          .prepare('PRAGMA table_info(characters)')
          .all() as Array<{ name: string }>
        if (!characterColumns.some((column) => column.name === 'archived')) {
          this.database.exec(
            'ALTER TABLE characters ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))'
          )
        }
      }

      if (version.user_version < 20) {
        const settingsColumns = this.database
          .prepare('PRAGMA table_info(settings)')
          .all() as Array<{ name: string }>
        if (!settingsColumns.some((column) => column.name === 'private_api_key')) {
          this.database.exec(
            "ALTER TABLE settings ADD COLUMN private_api_key TEXT NOT NULL DEFAULT ''"
          )
        }
      }

      if (version.user_version < 21) {
        this.database.exec(`
          CREATE TABLE IF NOT EXISTS story_saves (
            scope TEXT NOT NULL CHECK (scope IN ('normal', 'private')),
            id TEXT NOT NULL,
            story_id TEXT NOT NULL,
            name TEXT NOT NULL,
            story_json TEXT NOT NULL,
            messages_json TEXT NOT NULL,
            debug_traces_json TEXT NOT NULL,
            thumbnail_data_url TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (scope, id),
            FOREIGN KEY (scope, story_id) REFERENCES stories(scope, id) ON DELETE CASCADE
          ) STRICT;
          CREATE INDEX IF NOT EXISTS story_saves_by_story
            ON story_saves(scope, story_id, created_at DESC);
        `)
      }

      if (version.user_version < 22) {
        const characterColumns = this.database
          .prepare('PRAGMA table_info(characters)')
          .all() as Array<{ name: string }>
        if (!characterColumns.some((column) => column.name === 'image_generation_lora')) {
          this.database.exec(
            "ALTER TABLE characters ADD COLUMN image_generation_lora TEXT NOT NULL DEFAULT ''"
          )
        }
      }

      if (version.user_version < 23) {
        const imageColumns = this.database.prepare('PRAGMA table_info(images)').all() as Array<{
          name: string
        }>
        if (imageColumns.some((column) => column.name === 'description')) {
          this.database.exec('ALTER TABLE images DROP COLUMN description')
        }

        const stories = this.database.prepare(`
          SELECT scope, id, image_catalog_snapshot_json
          FROM stories
          WHERE image_catalog_snapshot_json IS NOT NULL
        `).all() as Array<{ scope: string; id: string; image_catalog_snapshot_json: string }>
        const updateStory = this.database.prepare(`
          UPDATE stories SET image_catalog_snapshot_json = ? WHERE scope = ? AND id = ?
        `)
        for (const story of stories) {
          updateStory.run(
            json(imageCatalogSnapshot(parseJson(story.image_catalog_snapshot_json, []))),
            story.scope,
            story.id
          )
        }

        const saves = this.database.prepare('SELECT scope, id, story_json FROM story_saves').all() as Array<{
          scope: string
          id: string
          story_json: string
        }>
        const updateSave = this.database.prepare(
          'UPDATE story_saves SET story_json = ? WHERE scope = ? AND id = ?'
        )
        for (const save of saves) {
          updateSave.run(
            json(storyWithoutImageDescriptions(parseJson(save.story_json, {}))),
            save.scope,
            save.id
          )
        }
      }

      if (version.user_version < 24) {
        const characterColors = new Map(
          (this.database.prepare('SELECT scope, id, color FROM characters').all() as Array<{
            scope: string
            id: string
            color: string
          }>).map((character) => [`${character.scope}\0${character.id}`, character.color])
        )
        const colorFor = (scope: string, characterId: string) =>
          characterColors.get(`${scope}\0${characterId}`)

        const stories = this.database.prepare(`
          SELECT scope, id, character_customizations_json
          FROM stories
        `).all() as Array<{
          scope: string
          id: string
          character_customizations_json: string
        }>
        const updateStory = this.database.prepare(`
          UPDATE stories SET character_customizations_json = ? WHERE scope = ? AND id = ?
        `)
        for (const story of stories) {
          const customizations = parseJson(story.character_customizations_json, [])
          const normalized = storyWithCharacterColors(
            { characterCustomizations: customizations },
            (characterId) => colorFor(story.scope, characterId)
          )
          updateStory.run(json(normalized.characterCustomizations), story.scope, story.id)
        }

        const saves = this.database.prepare('SELECT scope, id, story_json FROM story_saves').all() as Array<{
          scope: string
          id: string
          story_json: string
        }>
        const updateSave = this.database.prepare(
          'UPDATE story_saves SET story_json = ? WHERE scope = ? AND id = ?'
        )
        for (const save of saves) {
          updateSave.run(
            json(storyWithCharacterColors(
              parseJson(save.story_json, {}),
              (characterId) => colorFor(save.scope, characterId)
            )),
            save.scope,
            save.id
          )
        }
      }

      if (version.user_version < 25) {
        const characterColumns = this.database
          .prepare('PRAGMA table_info(characters)')
          .all() as Array<{ name: string }>
        if (!characterColumns.some((column) => column.name === 'image_generation_seed')) {
          this.database.exec(
            "ALTER TABLE characters ADD COLUMN image_generation_seed TEXT NOT NULL DEFAULT ''"
          )
        }
        if (!characterColumns.some((column) => column.name === 'image_generation_prompt_prefix')) {
          this.database.exec(
            "ALTER TABLE characters ADD COLUMN image_generation_prompt_prefix TEXT NOT NULL DEFAULT ''"
          )
        }
      }

      if (version.user_version < 26) {
        const storyColumns = this.database
          .prepare('PRAGMA table_info(stories)')
          .all() as Array<{ name: string }>
        if (!storyColumns.some((column) => column.name === 'context_summary')) {
          this.database.exec(
            "ALTER TABLE stories ADD COLUMN context_summary TEXT NOT NULL DEFAULT ''"
          )
        }
        if (!storyColumns.some((column) => column.name === 'context_summary_through_message_id')) {
          this.database.exec(
            'ALTER TABLE stories ADD COLUMN context_summary_through_message_id TEXT'
          )
        }
      }

      if (version.user_version < 27) {
        const columns = this.database.prepare('PRAGMA table_info(images)').all() as Array<{ name: string }>
        if (!columns.some((column) => column.name === 'original_data')) {
          this.database.exec('ALTER TABLE images ADD COLUMN original_data BLOB')
        }
        if (!columns.some((column) => column.name === 'original_mime_type')) {
          this.database.exec('ALTER TABLE images ADD COLUMN original_mime_type TEXT')
        }
      }

      if (version.user_version < 28) {
        this.database.exec(`
          CREATE TABLE IF NOT EXISTS swarm_prompts (
            scope TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, prompt TEXT NOT NULL,
            tags_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            PRIMARY KEY(scope, id)
          );
          CREATE INDEX IF NOT EXISTS swarm_prompts_by_created_at ON swarm_prompts(scope, created_at);
        `)
        const columns = this.database.prepare('PRAGMA table_info(images)').all() as Array<{ name: string }>
        if (!columns.some((column) => column.name === 'generation_json')) {
          this.database.exec('ALTER TABLE images ADD COLUMN generation_json TEXT')
        }
      }

      this.database.exec(`
        CREATE TRIGGER IF NOT EXISTS images_cleanup_blob_after_delete
        AFTER DELETE ON images
        BEGIN
          DELETE FROM image_blobs
          WHERE scope = OLD.scope
            AND id = OLD.blob_id
            AND NOT EXISTS (
              SELECT 1 FROM images
              WHERE scope = OLD.scope AND blob_id = OLD.blob_id
            );
        END;

        CREATE TRIGGER IF NOT EXISTS images_cleanup_blob_after_update
        AFTER UPDATE OF blob_id ON images
        WHEN OLD.blob_id <> NEW.blob_id
        BEGIN
          DELETE FROM image_blobs
          WHERE scope = OLD.scope
            AND id = OLD.blob_id
            AND NOT EXISTS (
              SELECT 1 FROM images
              WHERE scope = OLD.scope AND blob_id = OLD.blob_id
            );
        END;
      `)

        this.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
      })
    } catch (caught) {
      const backupDetail = backupPath ? ` Backup: ${backupPath}.` : ''
      throw new Error(
        `Falló la migración SQLite v${version.user_version} a v${SCHEMA_VERSION}.${backupDetail}`,
        { cause: caught }
      )
    }
  }

  transaction<T>(callback: () => T): T {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = callback()
      this.database.exec('COMMIT')
      return result
    } catch (caught) {
      this.database.exec('ROLLBACK')
      throw caught
    }
  }

  close() {
    if (this.database.isOpen) this.database.close()
  }

  health() {
    const version = this.database.prepare('PRAGMA user_version').get() as { user_version: number }
    this.database.prepare('SELECT 1').get()
    return { ok: true, schemaVersion: version.user_version }
  }

  list<R extends DataResource>(resource: R, scope: DataScope, query?: ResourceQuery): DataRecordMap[R][]
  list(resource: DataResource, scope: DataScope, query: ResourceQuery = {}) {
    switch (resource) {
      case 'characters':
        return (this.database
          .prepare('SELECT * FROM characters WHERE scope = ? ORDER BY name COLLATE NOCASE')
          .all(scope) as SqliteRow[]).map(rowToCharacter)
      case 'images': {
        const rows = query.characterId
          ? this.database
              .prepare(
                'SELECT scope, id, character_id, tags_json, is_default, mime_type, created_at, generation_json, original_data IS NOT NULL AS has_original FROM images WHERE scope = ? AND character_id = ? ORDER BY created_at'
              )
              .all(scope, query.characterId)
          : this.database
              .prepare(
                'SELECT scope, id, character_id, tags_json, is_default, mime_type, created_at, generation_json, original_data IS NOT NULL AS has_original FROM images WHERE scope = ? ORDER BY created_at'
              )
              .all(scope)
        return (rows as SqliteRow[]).map(rowToImage)
      }
      case 'backgrounds':
        return (this.database
          .prepare(
            'SELECT scope, id, tags_json, description, mime_type, created_at FROM backgrounds WHERE scope = ? ORDER BY created_at'
          )
          .all(scope) as SqliteRow[]).map(rowToBackground)
      case 'sounds':
        return (this.database
          .prepare(
            'SELECT scope, id, tags_json, character_id, background_id, mime_type, created_at FROM sounds WHERE scope = ? ORDER BY created_at'
          )
          .all(scope) as SqliteRow[]).map(rowToSound)
      case 'stories':
        return (this.database
          .prepare('SELECT * FROM stories WHERE scope = ? ORDER BY updated_at DESC')
          .all(scope) as SqliteRow[]).map(rowToStory)
      case 'messages':
        return (this.database
          .prepare('SELECT * FROM messages WHERE scope = ? AND story_id = ? ORDER BY created_at')
          .all(scope, query.storyId ?? '') as SqliteRow[]).map(rowToMessage)
      case 'llmDebugTraces':
        return (this.database
          .prepare(
            'SELECT * FROM llm_debug_traces WHERE scope = ? AND story_id = ? ORDER BY created_at'
          )
          .all(scope, query.storyId ?? '') as SqliteRow[]).map(rowToTrace)
      case 'storySaves':
        return (this.database
          .prepare(
            'SELECT * FROM story_saves WHERE scope = ? AND story_id = ? ORDER BY created_at DESC'
          )
          .all(scope, query.storyId ?? '') as SqliteRow[]).map(rowToStorySave)
      case 'swarmPrompts':
        return (this.database.prepare('SELECT * FROM swarm_prompts WHERE scope = ? ORDER BY created_at, rowid')
          .all(scope) as SqliteRow[]).map(rowToSwarmPrompt)
      case 'presets':
        return (this.database
          .prepare('SELECT * FROM presets WHERE scope = ? ORDER BY created_at')
          .all(scope) as SqliteRow[]).map(rowToPreset)
    }
  }

  get<R extends DataResource>(resource: R, scope: DataScope, id: string): DataRecordMap[R] | null
  get(resource: DataResource, scope: DataScope, id: string) {
    const table = resource === 'llmDebugTraces'
      ? 'llm_debug_traces'
      : resource === 'storySaves'
        ? 'story_saves'
        : resource === 'swarmPrompts' ? 'swarm_prompts' : resource
    const row = this.database
      .prepare(`SELECT * FROM ${table} WHERE scope = ? AND id = ?`)
      .get(scope, id) as SqliteRow | undefined
    if (!row) return null
    switch (resource) {
      case 'characters':
        return rowToCharacter(row)
      case 'images':
        return rowToImage(row)
      case 'backgrounds':
        return rowToBackground(row)
      case 'sounds':
        return rowToSound(row)
      case 'stories':
        return rowToStory(row)
      case 'messages':
        return rowToMessage(row)
      case 'llmDebugTraces':
        return rowToTrace(row)
      case 'storySaves':
        return rowToStorySave(row)
      case 'swarmPrompts':
        return rowToSwarmPrompt(row)
      case 'presets':
        return rowToPreset(row)
    }
  }

  getBinary(resource: 'images' | 'backgrounds' | 'sounds', scope: DataScope, id: string) {
    const row = (resource === 'images'
      ? this.database
          .prepare(`
            SELECT images.mime_type, image_blobs.data
            FROM images
            INNER JOIN image_blobs
              ON image_blobs.scope = images.scope AND image_blobs.id = images.blob_id
            WHERE images.scope = ? AND images.id = ?
          `)
          .get(scope, id)
      : resource === 'backgrounds'
        ? this.database
            .prepare('SELECT mime_type, data FROM backgrounds WHERE scope = ? AND id = ?')
            .get(scope, id)
        : this.database
            .prepare('SELECT mime_type, data FROM sounds WHERE scope = ? AND id = ?')
            .get(scope, id)) as { mime_type: string; data: Uint8Array } | undefined
    return row ? { mimeType: row.mime_type, data: row.data } : null
  }

  getOriginalImage(scope: DataScope, id: string) {
    const row = this.database.prepare(`
      SELECT original_mime_type, original_data FROM images
      WHERE scope = ? AND id = ? AND original_data IS NOT NULL
    `).get(scope, id) as { original_mime_type: string; original_data: Uint8Array } | undefined
    return row ? { mimeType: row.original_mime_type, data: row.original_data } : null
  }

  restoreImage(scope: DataScope, id: string) {
    const original = this.getOriginalImage(scope, id)
    const metadata = this.get('images', scope, id)
    if (!original || !metadata) return null
    return this.putBinary('images', scope, id, {
      metadata: { ...metadata, mimeType: original.mimeType },
      data: original.data
    })
  }

  copyCharacter(scope: DataScope, sourceId: string, rawValue: unknown) {
    const source = this.get('characters', scope, sourceId)
    if (!source) return null
    const value = record(rawValue)
    const characterId = randomUUID()
    const now = Date.now()

    return this.transaction(() => {
      const character = this.put('characters', scope, characterId, {
        id: characterId,
        name: text(value.name),
        prompt: text(value.prompt),
        tags: tags(value.tags),
        color: text(value.color),
        imageGenerationPreset:
          typeof value.imageGenerationPreset === 'string'
            ? value.imageGenerationPreset
            : source.imageGenerationPreset,
        imageGenerationLora:
          typeof value.imageGenerationLora === 'string'
            ? value.imageGenerationLora
            : source.imageGenerationLora,
        imageGenerationSeed:
          typeof value.imageGenerationSeed === 'string'
            ? value.imageGenerationSeed
            : source.imageGenerationSeed,
        imageGenerationPromptPrefix:
          typeof value.imageGenerationPromptPrefix === 'string'
            ? value.imageGenerationPromptPrefix
            : source.imageGenerationPromptPrefix,
        archived: false,
        createdAt: now,
        updatedAt: now
      })
      const sourceImages = this.database
        .prepare(`
          SELECT tags_json, is_default, mime_type, created_at, blob_id, original_data, original_mime_type, generation_json
          FROM images
          WHERE scope = ? AND character_id = ?
          ORDER BY created_at, id
        `)
        .all(scope, sourceId) as Array<{
        tags_json: string
        is_default: number
        mime_type: string
        created_at: number
        blob_id: string
        original_data: Uint8Array | null
        original_mime_type: string | null
        generation_json: string | null
      }>
      const insertImage = this.database.prepare(`
        INSERT INTO images(
          scope, id, character_id, tags_json, is_default,
          mime_type, created_at, blob_id, original_data, original_mime_type, generation_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const image of sourceImages) {
        insertImage.run(
          scope,
          randomUUID(),
          characterId,
          image.tags_json,
          image.is_default,
          image.mime_type,
          image.created_at,
          image.blob_id,
          image.original_data,
          image.original_mime_type,
          image.generation_json
        )
      }
      return {
        character,
        images: this.list('images', scope, { characterId })
      }
    })
  }

  importCharacter(
    scope: DataScope,
    targetId: string | null,
    payload: CharacterImportPayload
  ) {
    const existing = targetId ? this.get('characters', scope, targetId) : null
    if (targetId && !existing) return null
    const characterId = targetId ?? randomUUID()
    const now = Date.now()

    return this.transaction(() => {
      if (targetId) {
        this.database
          .prepare('DELETE FROM images WHERE scope = ? AND character_id = ?')
          .run(scope, characterId)
        this.database
          .prepare('DELETE FROM sounds WHERE scope = ? AND character_id = ?')
          .run(scope, characterId)
      }

      const character = this.put('characters', scope, characterId, {
        id: characterId,
        name: payload.name,
        prompt: payload.prompt,
        tags: payload.tags,
        color: payload.color,
        imageGenerationPreset: payload.imageGenerationPreset,
        imageGenerationLora: payload.imageGenerationLora,
        imageGenerationSeed: payload.imageGenerationSeed,
        imageGenerationPromptPrefix: payload.imageGenerationPromptPrefix,
        archived: existing?.archived ?? false,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      })

      const insertBlob = this.database.prepare(
        'INSERT INTO image_blobs(scope, id, data) VALUES (?, ?, ?)'
      )
      const insertImage = this.database.prepare(`
        INSERT INTO images(
          scope, id, character_id, tags_json, is_default,
          mime_type, created_at, blob_id, original_data, original_mime_type, generation_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const [index, image] of payload.images.entries()) {
        const imageId = randomUUID()
        const imageTags = tags(image.metadata.tags)
        if (imageTags.length === 0) imageTags.push('neutral')
        insertBlob.run(scope, imageId, image.data)
        insertImage.run(
          scope,
          imageId,
          characterId,
          json(imageTags),
          bool(image.metadata.isDefault),
          text(image.metadata.mimeType),
          now + index,
          imageId,
          image.original?.data ?? null,
          image.original?.mimeType ?? null,
          json(readImageGeneration(image.metadata.generation))
        )
      }

      const usedSoundTags = new Set(
        (this.list('sounds', scope) as Array<{ tags: string[] }>)
          .flatMap((sound) => sound.tags)
          .map(tagKey)
      )
      const insertSound = this.database.prepare(`
        INSERT INTO sounds(
          scope, id, tags_json, character_id, background_id, mime_type, created_at, data
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
      `)
      for (const [index, sound] of payload.sounds.entries()) {
        const soundTags = tags(sound.metadata.tags).map((base) => {
          const available = nextAvailableTag(base, usedSoundTags)
          usedSoundTags.add(tagKey(available))
          return available
        })
        insertSound.run(
          scope,
          randomUUID(),
          json(soundTags),
          characterId,
          text(sound.metadata.mimeType),
          now + index,
          sound.data
        )
      }

      return {
        character,
        images: this.list('images', scope, { characterId }),
        sounds: (this.list('sounds', scope) as Array<Record<string, unknown>>)
          .filter((sound) => sound.characterId === characterId)
      }
    })
  }

  put<R extends JsonResource>(
    resource: R,
    scope: DataScope,
    id: string,
    rawValue: unknown
  ): DataRecordMap[R]
  put(
    resource: JsonResource,
    scope: DataScope,
    id: string,
    rawValue: unknown
  ) {
    const value = record(rawValue)
    switch (resource) {
      case 'characters':
        this.database
          .prepare(`
            INSERT INTO characters(
              scope, id, name, prompt, tags_json, color, image_generation_preset,
              image_generation_lora, image_generation_seed, image_generation_prompt_prefix, archived,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scope, id) DO UPDATE SET
              name = excluded.name,
              prompt = excluded.prompt,
              tags_json = excluded.tags_json,
              color = excluded.color,
              image_generation_preset = excluded.image_generation_preset,
              image_generation_lora = excluded.image_generation_lora,
              image_generation_seed = excluded.image_generation_seed,
              image_generation_prompt_prefix = excluded.image_generation_prompt_prefix,
              archived = excluded.archived,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at
          `)
          .run(
            scope,
            id,
            text(value.name),
            text(value.prompt),
            json(tags(value.tags)),
            text(value.color),
            text(value.imageGenerationPreset),
            text(value.imageGenerationLora),
            text(value.imageGenerationSeed),
            text(value.imageGenerationPromptPrefix),
            bool(value.archived),
            integer(value.createdAt),
            integer(value.updatedAt)
          )
        break
      case 'stories':
        this.database
          .prepare(`
            INSERT INTO stories(
              scope, id, title, premise, visual_mode, protagonist_preferences,
              protagonist_preferences_mode, character_ids_json, character_customizations_json,
              initial_background_id, preset_id, image_catalog_snapshot_json,
              pending_image_instructions_json, context_summary,
              context_summary_through_message_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scope, id) DO UPDATE SET
              title = excluded.title,
              premise = excluded.premise,
              visual_mode = excluded.visual_mode,
              protagonist_preferences = excluded.protagonist_preferences,
              protagonist_preferences_mode = excluded.protagonist_preferences_mode,
              character_ids_json = excluded.character_ids_json,
              character_customizations_json = excluded.character_customizations_json,
              initial_background_id = excluded.initial_background_id,
              preset_id = excluded.preset_id,
              image_catalog_snapshot_json = excluded.image_catalog_snapshot_json,
              pending_image_instructions_json = excluded.pending_image_instructions_json,
              context_summary = excluded.context_summary,
              context_summary_through_message_id = excluded.context_summary_through_message_id,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at
          `)
          .run(
            scope,
            id,
            text(value.title),
            text(value.premise),
            value.visualMode === true ? 1 : 0,
            text(value.protagonistPreferences),
            value.protagonistPreferencesMode === 'replace' ? 'replace' : 'append',
            json(stringArray(value.characterIds)),
            json(value.characterCustomizations),
            typeof value.initialBackgroundId === 'string' ? value.initialBackgroundId : null,
            typeof value.presetId === 'string' ? value.presetId : null,
            value.imageCatalogSnapshot === undefined ? null : json(value.imageCatalogSnapshot),
            json(Array.isArray(value.pendingImageInstructions) ? value.pendingImageInstructions : []),
            text(value.contextSummary),
            typeof value.contextSummaryThroughMessageId === 'string'
              ? value.contextSummaryThroughMessageId
              : null,
            integer(value.createdAt),
            integer(value.updatedAt)
          )
        break
      case 'messages':
        this.database
          .prepare(`
            INSERT INTO messages(scope, id, story_id, role, raw, segments_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scope, id) DO UPDATE SET
              story_id = excluded.story_id,
              role = excluded.role,
              raw = excluded.raw,
              segments_json = excluded.segments_json,
              created_at = excluded.created_at
          `)
          .run(
            scope,
            id,
            text(value.storyId),
            value.role === 'assistant' ? 'assistant' : 'user',
            text(value.raw),
            json(Array.isArray(value.segments) ? value.segments : []),
            integer(value.createdAt)
          )
        break
      case 'llmDebugTraces':
        this.database
          .prepare(`
            INSERT INTO llm_debug_traces(
              scope, id, story_id, request_message_id, response_message_id,
              status, request_json, response_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scope, id) DO UPDATE SET
              story_id = excluded.story_id,
              request_message_id = excluded.request_message_id,
              response_message_id = excluded.response_message_id,
              status = excluded.status,
              request_json = excluded.request_json,
              response_json = excluded.response_json,
              created_at = excluded.created_at
          `)
          .run(
            scope,
            id,
            text(value.storyId),
            typeof value.requestMessageId === 'string' ? value.requestMessageId : null,
            typeof value.responseMessageId === 'string' ? value.responseMessageId : null,
            value.status === 'error' ? 'error' : 'success',
            json(record(value.request)),
            json(record(value.response)),
            integer(value.createdAt)
          )
        break
      case 'storySaves':
        this.database
          .prepare(`
            INSERT INTO story_saves(
              scope, id, story_id, name, story_json, messages_json,
              debug_traces_json, thumbnail_data_url, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scope, id) DO UPDATE SET
              story_id = excluded.story_id,
              name = excluded.name,
              story_json = excluded.story_json,
              messages_json = excluded.messages_json,
              debug_traces_json = excluded.debug_traces_json,
              thumbnail_data_url = excluded.thumbnail_data_url,
              created_at = excluded.created_at
          `)
          .run(
            scope,
            id,
            text(value.storyId),
            text(value.name),
            json(record(value.story)),
            json(Array.isArray(value.messages) ? value.messages : []),
            json(Array.isArray(value.debugTraces) ? value.debugTraces : []),
            text(value.thumbnailDataUrl),
            integer(value.createdAt)
          )
        break
      case 'swarmPrompts':
        if (!text(value.name).trim() || !text(value.prompt).trim()) throw new Error('Nombre y prompt obligatorios')
        this.database.prepare(`
          INSERT INTO swarm_prompts(scope, id, name, prompt, tags_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(scope, id) DO UPDATE SET name = excluded.name, prompt = excluded.prompt,
            tags_json = excluded.tags_json, updated_at = excluded.updated_at
        `).run(scope, id, text(value.name).trim(), text(value.prompt).trim(), json(tags(value.tags)),
          integer(value.createdAt), integer(value.updatedAt))
        break
      case 'presets':
        this.database
          .prepare(`
            INSERT INTO presets(scope, id, name, content, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(scope, id) DO UPDATE SET
              name = excluded.name,
              content = excluded.content,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at
          `)
          .run(
            scope,
            id,
            text(value.name),
            text(value.content),
            integer(value.createdAt),
            integer(value.updatedAt)
          )
        break
    }
    const saved = this.get(resource, scope, id)
    if (!saved) throw new Error(`No se pudo recuperar ${resource}/${id} tras guardarlo`)
    return saved
  }

  putBinary(
    resource: 'images' | 'backgrounds' | 'sounds',
    scope: DataScope,
    id: string,
    payload: BinaryPayload
  ) {
    const value = payload.metadata
    if (resource === 'images') {
      return this.transaction(() => {
        const characterId = text(value.characterId)
        const isDefault = Boolean(value.isDefault)
        const current = this.database
          .prepare(`
            SELECT images.blob_id, images.mime_type, images.original_data, images.original_mime_type, image_blobs.data
            FROM images
            INNER JOIN image_blobs
              ON image_blobs.scope = images.scope AND image_blobs.id = images.blob_id
            WHERE images.scope = ? AND images.id = ?
          `)
          .get(scope, id) as {
            blob_id: string; data: Uint8Array; mime_type: string
            original_data: Uint8Array | null; original_mime_type: string | null
          } | undefined
        const blobId = current && sameBinary(current.data, payload.data)
          ? current.blob_id
          : current
            ? randomUUID()
            : id
        // La copia inicial es inmutable, también al restaurar o volver a recortar.
        const original = current?.original_data
          ? { data: current.original_data, mimeType: current.original_mime_type! }
          : current && blobId !== current.blob_id
            ? { data: current.data, mimeType: current.mime_type }
            : payload.original
        if (!current || blobId !== current.blob_id) {
          this.database
            .prepare('INSERT INTO image_blobs(scope, id, data) VALUES (?, ?, ?)')
            .run(scope, blobId, payload.data)
        }
        if (isDefault) {
          this.database
            .prepare('UPDATE images SET is_default = 0 WHERE scope = ? AND character_id = ? AND id <> ?')
            .run(scope, characterId, id)
        }
        this.database
          .prepare(`
            INSERT INTO images(
              scope, id, character_id, tags_json, is_default,
              mime_type, created_at, blob_id, original_data, original_mime_type, generation_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scope, id) DO UPDATE SET
              character_id = excluded.character_id,
              tags_json = excluded.tags_json,
              is_default = excluded.is_default,
              mime_type = excluded.mime_type,
              created_at = excluded.created_at,
              blob_id = excluded.blob_id,
              original_data = excluded.original_data,
              original_mime_type = excluded.original_mime_type,
              generation_json = excluded.generation_json
          `)
          .run(
            scope,
            id,
            characterId,
            json(tags(value.tags)),
            bool(isDefault),
            text(value.mimeType, 'application/octet-stream'),
            integer(value.createdAt),
            blobId,
            original?.data ?? null,
            original?.mimeType ?? null,
            json(readImageGeneration(value.generation))
          )
        return this.get('images', scope, id)
      })
    }

    if (resource === 'backgrounds') return this.transaction(() => {
      const preparedTags = tags(value.tags)
      const usedTags = new Set(
        (this.list('backgrounds', scope) as Array<{ id: string; tags: string[] }>)
          .filter((background) => background.id !== id)
          .flatMap((background) => background.tags)
          .map((tag) => tag.trim().toLocaleLowerCase())
      )
      if (preparedTags.some((tag) => usedTags.has(tag.toLocaleLowerCase()))) {
        throw Object.assign(new Error('Background tag conflict'), {
          code: 'ERR_BACKGROUND_TAG_CONFLICT'
        })
      }
      this.database
        .prepare(`
          INSERT INTO backgrounds(scope, id, tags_json, description, mime_type, created_at, data)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(scope, id) DO UPDATE SET
            tags_json = excluded.tags_json,
            description = excluded.description,
            mime_type = excluded.mime_type,
            created_at = excluded.created_at,
            data = excluded.data
        `)
        .run(
          scope,
          id,
          json(preparedTags),
          text(value.description),
          text(value.mimeType, 'application/octet-stream'),
          integer(value.createdAt),
          payload.data
        )
      return this.get('backgrounds', scope, id)
    })

    return this.transaction(() => {
      const preparedTags = tags(value.tags)
      const usedTags = new Set(
        (this.list('sounds', scope) as Array<{ id: string; tags: string[] }>)
          .filter((sound) => sound.id !== id)
          .flatMap((sound) => sound.tags)
          .map((tag) => tag.trim().toLocaleLowerCase())
      )
      if (preparedTags.some((tag) => usedTags.has(tag.toLocaleLowerCase()))) {
        throw Object.assign(new Error('Sound tag conflict'), {
          code: 'ERR_SOUND_TAG_CONFLICT'
        })
      }
      const characterId = typeof value.characterId === 'string' ? value.characterId : null
      const backgroundId = typeof value.backgroundId === 'string' ? value.backgroundId : null
      this.database
        .prepare(`
          INSERT INTO sounds(
            scope, id, tags_json, character_id, background_id, mime_type, created_at, data
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(scope, id) DO UPDATE SET
            tags_json = excluded.tags_json,
            character_id = excluded.character_id,
            background_id = excluded.background_id,
            mime_type = excluded.mime_type,
            created_at = excluded.created_at,
            data = excluded.data
        `)
        .run(
          scope,
          id,
          json(preparedTags),
          characterId,
          backgroundId,
          text(value.mimeType, 'application/octet-stream'),
          integer(value.createdAt),
          payload.data
        )
      return this.get('sounds', scope, id)
    })
  }

  delete(resource: DataResource, scope: DataScope, id: string) {
    if (resource === 'messages') {
      this.deleteMessages(scope, [id])
      return
    }
    if (resource === 'characters') {
      const stories = (this.database
        .prepare('SELECT id, title, character_ids_json FROM stories WHERE scope = ?')
        .all(scope) as Array<{ id: string; title: string; character_ids_json: string }>)
        .filter((story) => parseJson<string[]>(story.character_ids_json, []).includes(id))
        .map((story) => ({ id: story.id, title: story.title }))
      if (stories.length) {
        const error = new Error('El personaje se usa en historias') as Error & {
          code: string
          stories: Array<{ id: string; title: string }>
        }
        error.code = 'ERR_CHARACTER_IN_USE'
        error.stories = stories
        throw error
      }
    }
    const table = resource === 'llmDebugTraces'
      ? 'llm_debug_traces'
      : resource === 'storySaves'
        ? 'story_saves'
        : resource === 'swarmPrompts' ? 'swarm_prompts' : resource
    this.database.prepare(`DELETE FROM ${table} WHERE scope = ? AND id = ?`).run(scope, id)
  }

  createStorySave(scope: DataScope, storyId: string, name: string, thumbnailDataUrl: string) {
    return this.transaction(() => {
      const story = this.get('stories', scope, storyId) as Story | null
      if (!story) return null
      const save: StorySaveSlot = {
        id: randomUUID(),
        storyId,
        name,
        story,
        messages: this.list('messages', scope, { storyId }) as Message[],
        debugTraces: this.list('llmDebugTraces', scope, { storyId }) as LlmDebugTrace[],
        thumbnailDataUrl,
        createdAt: Date.now()
      }
      return this.put('storySaves', scope, save.id, save)
    })
  }

  loadStorySave(scope: DataScope, id: string) {
    return this.transaction(() => {
      const save = this.get('storySaves', scope, id) as StorySaveSlot | null
      if (!save) return null
      const current = this.get('stories', scope, save.storyId) as Story | null
      if (!current) return null
      const story = {
        ...save.story,
        id: save.storyId,
        createdAt: current.createdAt,
        updatedAt: Date.now()
      }
      this.put('stories', scope, save.storyId, story)
      this.database.prepare('DELETE FROM llm_debug_traces WHERE scope = ? AND story_id = ?')
        .run(scope, save.storyId)
      this.database.prepare('DELETE FROM messages WHERE scope = ? AND story_id = ?')
        .run(scope, save.storyId)
      for (const message of save.messages) {
        this.put('messages', scope, text(message.id), { ...message, storyId: save.storyId })
      }
      for (const trace of save.debugTraces) {
        this.put('llmDebugTraces', scope, text(trace.id), { ...trace, storyId: save.storyId })
      }
      return { save, story }
    })
  }

  deleteMessages(scope: DataScope, ids: string[]) {
    if (ids.length === 0) return
    this.transaction(() => {
      const deleteMessage = this.database.prepare('DELETE FROM messages WHERE scope = ? AND id = ?')
      for (const id of ids) deleteMessage.run(scope, id)

      const traces = this.database
        .prepare(`
          SELECT id, status, request_message_id, response_message_id, request_json
          FROM llm_debug_traces WHERE scope = ?
        `)
        .all(scope) as Array<{
        id: string
        status: 'success' | 'error'
        request_message_id: string | null
        response_message_id: string | null
        request_json: string
      }>
      const idSet = new Set(ids)
      const deleteTrace = this.database.prepare(
        'DELETE FROM llm_debug_traces WHERE scope = ? AND id = ?'
      )
      for (const trace of traces) {
        if (
          (trace.response_message_id && idSet.has(trace.response_message_id)) ||
          ((trace.status === 'error' ||
            parseJson<{ purpose?: string }>(trace.request_json, {}).purpose === 'compaction') &&
            trace.request_message_id &&
            idSet.has(trace.request_message_id))
        ) {
          deleteTrace.run(scope, trace.id)
        }
      }
    })
  }

  clear(scope: DataScope) {
    this.transaction(() => {
      for (const table of [
        'story_saves',
        'llm_debug_traces',
        'messages',
        'stories',
        'sounds',
        'images',
        'image_blobs',
        'characters',
        'backgrounds',
        'presets',
        'swarm_prompts'
      ]) {
        this.database.prepare(`DELETE FROM ${table} WHERE scope = ?`).run(scope)
      }
    })
  }

  readSettings(): SettingsRow | null {
    const row = this.database
      .prepare(
        "SELECT value_json, api_key, private_api_key, swarm_auth_token FROM settings WHERE key = 'app'"
      )
      .get() as {
        value_json: string
        api_key: string
        private_api_key: string
        swarm_auth_token: string
      } | undefined
    if (!row) return null
    return {
      value: parseJson(row.value_json, {}),
      apiKey: row.api_key,
      privateApiKey: row.private_api_key,
      swarmAuthToken: row.swarm_auth_token
    }
  }

  writeSettings(patchValue: unknown) {
    const patch = record(patchValue)
    const current = this.readSettings() ?? {
      value: {},
      apiKey: '',
      privateApiKey: '',
      swarmAuthToken: ''
    }
    const nextValue = { ...current.value }
    let nextApiKey = current.apiKey
    let nextPrivateApiKey = current.privateApiKey
    let nextSwarmAuthToken = current.swarmAuthToken
    if (
      patch.privateLlmSettingsEnabled === true &&
      current.value.privateLlmSettingsEnabled !== true &&
      !Object.hasOwn(patch, 'privateApiKey')
    ) {
      nextPrivateApiKey = current.apiKey
    }
    if (patch.privateLlmSettingsEnabled === false) nextPrivateApiKey = ''
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'apiKey') nextApiKey = text(value).trim()
      else if (key === 'privateApiKey') nextPrivateApiKey = text(value).trim()
      else if (key === 'swarmAuthToken') nextSwarmAuthToken = text(value).trim()
      else if (
        key !== 'apiKeyConfigured' &&
        key !== 'privateApiKeyConfigured' &&
        key !== 'swarmAuthConfigured'
      ) nextValue[key] = value
    }
    this.database
      .prepare(`
        INSERT INTO settings(
          key, value_json, api_key, private_api_key, swarm_auth_token
        ) VALUES ('app', ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          api_key = excluded.api_key,
          private_api_key = excluded.private_api_key,
          swarm_auth_token = excluded.swarm_auth_token
      `)
      .run(json(nextValue), nextApiKey, nextPrivateApiKey, nextSwarmAuthToken)
    return {
      value: nextValue,
      apiKey: nextApiKey,
      privateApiKey: nextPrivateApiKey,
      swarmAuthToken: nextSwarmAuthToken
    }
  }
}

interface StorageGlobal {
  __misHistoriasStorage?: Map<string, MisHistoriasStorage>
}

export function getStorage(path = resolveDatabasePath()) {
  const globalState = globalThis as typeof globalThis & StorageGlobal
  globalState.__misHistoriasStorage ??= new Map()
  const existing = globalState.__misHistoriasStorage.get(path)
  if (existing?.database.isOpen) return existing
  const storage = new MisHistoriasStorage(path)
  globalState.__misHistoriasStorage.set(path, storage)
  return storage
}
