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
import type { DatabaseBackup, DatabaseBackupKind } from '../../shared/types/index.ts'

export type DataScope = 'normal' | 'private'
export type DataResource =
  | 'characters'
  | 'images'
  | 'backgrounds'
  | 'sounds'
  | 'stories'
  | 'messages'
  | 'llmDebugTraces'
  | 'presets'

export interface ResourceQuery {
  storyId?: string
  characterId?: string
}

export interface BinaryPayload {
  metadata: Record<string, unknown>
  data: Uint8Array
}

export interface CharacterImportPayload {
  name: string
  prompt: string
  tags: string[]
  color: string
  imageGenerationPreset: string
  images: BinaryPayload[]
  sounds: BinaryPayload[]
}

interface SettingsRow {
  value: Record<string, unknown>
  apiKey: string
  swarmAuthToken: string
}

interface SqliteRow extends Record<string, unknown> {
  id: string
  scope: DataScope
}

const SCHEMA_VERSION = 17
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

function rowToCharacter(row: SqliteRow) {
  return {
    id: row.id,
    name: text(row.name),
    prompt: text(row.prompt),
    tags: parseJson<string[]>(row.tags_json, []),
    color: text(row.color),
    imageGenerationPreset: text(row.image_generation_preset),
    createdAt: integer(row.created_at),
    updatedAt: integer(row.updated_at)
  }
}

function rowToImage(row: SqliteRow) {
  return {
    id: row.id,
    characterId: text(row.character_id),
    tags: parseJson<string[]>(row.tags_json, []),
    description: text(row.description),
    isDefault: Boolean(row.is_default),
    mimeType: text(row.mime_type, 'application/octet-stream'),
    createdAt: integer(row.created_at)
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
    characterCustomizations: parseJson(row.character_customizations_json, []),
    initialBackgroundId:
      typeof row.initial_background_id === 'string' ? row.initial_background_id : null,
    presetId: typeof row.preset_id === 'string' ? row.preset_id : null,
    imageCatalogSnapshot:
      row.image_catalog_snapshot_json === null
        ? undefined
        : parseJson(row.image_catalog_snapshot_json, undefined),
    pendingImageInstructions: parseJson(row.pending_image_instructions_json, []),
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
          description TEXT NOT NULL,
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

      if (version.user_version < 8) {
        this.database.exec(`
          CREATE TABLE IF NOT EXISTS nsfw_users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            avatar_asset_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            last_login_at INTEGER
          ) STRICT;

          CREATE TABLE IF NOT EXISTS nsfw_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES nsfw_users(id) ON DELETE CASCADE
          ) STRICT;
          CREATE INDEX IF NOT EXISTS nsfw_sessions_by_user
            ON nsfw_sessions(user_id, expires_at);

          CREATE TABLE IF NOT EXISTS nsfw_story_sessions (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT NOT NULL,
            format TEXT NOT NULL CHECK (format IN ('story', 'chat', 'vn')),
            title TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (owner_user_id) REFERENCES nsfw_users(id)
          ) STRICT;
          CREATE INDEX IF NOT EXISTS nsfw_story_sessions_by_owner
            ON nsfw_story_sessions(owner_user_id, updated_at DESC);
        `)
      }

      if (version.user_version < 9) {
        const sessionColumns = this.database
          .prepare('PRAGMA table_info(nsfw_story_sessions)')
          .all() as Array<{ name: string }>
        const sessionNames = new Set(sessionColumns.map((column) => column.name))
        const addSessionColumn = (name: string, ddl: string) => {
          if (!sessionNames.has(name)) {
            this.database.exec(`ALTER TABLE nsfw_story_sessions ADD COLUMN ${ddl}`)
          }
        }
        addSessionColumn('premise', "premise TEXT NOT NULL DEFAULT ''")
        addSessionColumn('duration', "duration TEXT NOT NULL DEFAULT 'medium'")
        addSessionColumn('tone', "tone TEXT NOT NULL DEFAULT 'sensual'")
        addSessionColumn('perspective', "perspective TEXT NOT NULL DEFAULT 'second'")
        addSessionColumn('interaction_policy', "interaction_policy TEXT NOT NULL DEFAULT 'pause'")
        addSessionColumn('generation_profile', "generation_profile TEXT NOT NULL DEFAULT 'quick'")
        addSessionColumn('model_alias', "model_alias TEXT NOT NULL DEFAULT ''")
        addSessionColumn('head_beat_id', 'head_beat_id TEXT')
        addSessionColumn('revision', 'revision INTEGER NOT NULL DEFAULT 0')
        addSessionColumn('plan_json', "plan_json TEXT NOT NULL DEFAULT '{}'")
        addSessionColumn('bible_json', "bible_json TEXT NOT NULL DEFAULT '{}'")
        addSessionColumn('world_state_json', "world_state_json TEXT NOT NULL DEFAULT '{}'")
        addSessionColumn('scene_state_json', "scene_state_json TEXT NOT NULL DEFAULT '{}'")
        addSessionColumn('cast_json', "cast_json TEXT NOT NULL DEFAULT '[]'")
        addSessionColumn('interests_json', "interests_json TEXT NOT NULL DEFAULT '[]'")
        addSessionColumn('exclusions_json', "exclusions_json TEXT NOT NULL DEFAULT '[]'")
        addSessionColumn('archived', 'archived INTEGER NOT NULL DEFAULT 0')
        addSessionColumn('privacy_notice_seen', 'privacy_notice_seen INTEGER NOT NULL DEFAULT 1')

        this.database.exec(`
          CREATE TABLE IF NOT EXISTS nsfw_beats (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            parent_beat_id TEXT,
            accepted_attempt_id TEXT NOT NULL,
            envelope_json TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES nsfw_story_sessions(id) ON DELETE CASCADE
          ) STRICT;
          CREATE INDEX IF NOT EXISTS nsfw_beats_by_session
            ON nsfw_beats(session_id, sequence);

          CREATE TABLE IF NOT EXISTS nsfw_generation_attempts (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            parent_beat_id TEXT,
            sibling_group_id TEXT NOT NULL,
            input_json TEXT NOT NULL,
            input_fingerprint TEXT NOT NULL,
            model_alias TEXT NOT NULL,
            model_id TEXT NOT NULL,
            generation_profile TEXT NOT NULL,
            state TEXT NOT NULL,
            envelope_json TEXT,
            provisional_text TEXT NOT NULL DEFAULT '',
            error_message TEXT,
            usage_json TEXT NOT NULL,
            retry_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES nsfw_story_sessions(id) ON DELETE CASCADE
          ) STRICT;
          CREATE INDEX IF NOT EXISTS nsfw_attempts_by_session
            ON nsfw_generation_attempts(session_id, created_at DESC);

          CREATE TABLE IF NOT EXISTS nsfw_generation_usage (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            attempt_id TEXT NOT NULL,
            category TEXT NOT NULL,
            prompt_tokens INTEGER NOT NULL,
            completion_tokens INTEGER NOT NULL,
            total_tokens INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES nsfw_story_sessions(id) ON DELETE CASCADE
          ) STRICT;
          CREATE INDEX IF NOT EXISTS nsfw_usage_by_session
            ON nsfw_generation_usage(session_id, created_at DESC);
        `)
      }

      if (version.user_version < 10) {
        const sessionColumns = this.database
          .prepare('PRAGMA table_info(nsfw_story_sessions)')
          .all() as Array<{ name: string }>
        const sessionNames = new Set(sessionColumns.map((column) => column.name))
        const addSessionColumn = (name: string, ddl: string) => {
          if (!sessionNames.has(name)) {
            this.database.exec(`ALTER TABLE nsfw_story_sessions ADD COLUMN ${ddl}`)
          }
        }
        addSessionColumn('parent_session_id', 'parent_session_id TEXT')
        addSessionColumn('fork_beat_id', 'fork_beat_id TEXT')
        addSessionColumn('sequel_of_session_id', 'sequel_of_session_id TEXT')
        addSessionColumn('branch_label', 'branch_label TEXT')
        addSessionColumn('finalized_at', 'finalized_at INTEGER')
      }

      if (version.user_version < 11) {
        this.database.exec(`
          CREATE TABLE IF NOT EXISTS nsfw_vn_saves (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            owner_user_id TEXT NOT NULL,
            label TEXT NOT NULL,
            head_beat_id TEXT,
            is_autosave INTEGER NOT NULL DEFAULT 0 CHECK (is_autosave IN (0, 1)),
            payload_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES nsfw_story_sessions(id) ON DELETE CASCADE
          ) STRICT;
          CREATE INDEX IF NOT EXISTS nsfw_vn_saves_by_session
            ON nsfw_vn_saves(session_id, updated_at DESC);

          CREATE TABLE IF NOT EXISTS nsfw_read_units (
            session_id TEXT NOT NULL,
            beat_id TEXT NOT NULL,
            unit_index INTEGER NOT NULL,
            read_at INTEGER NOT NULL,
            PRIMARY KEY (session_id, beat_id, unit_index),
            FOREIGN KEY (session_id) REFERENCES nsfw_story_sessions(id) ON DELETE CASCADE
          ) STRICT;
        `)
      }

      if (version.user_version < 12) {
        this.database.exec(`
          CREATE TABLE IF NOT EXISTS nsfw_studio_characters (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            color TEXT NOT NULL,
            defaults_json TEXT NOT NULL,
            published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (owner_user_id) REFERENCES nsfw_users(id)
          ) STRICT;
          CREATE INDEX IF NOT EXISTS nsfw_studio_characters_by_owner
            ON nsfw_studio_characters(owner_user_id, updated_at DESC);

          CREATE TABLE IF NOT EXISTS nsfw_studio_sprites (
            id TEXT PRIMARY KEY,
            character_id TEXT NOT NULL,
            owner_user_id TEXT NOT NULL,
            label TEXT NOT NULL,
            facets_json TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            data BLOB,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (character_id) REFERENCES nsfw_studio_characters(id) ON DELETE CASCADE,
            FOREIGN KEY (owner_user_id) REFERENCES nsfw_users(id)
          ) STRICT;
          CREATE INDEX IF NOT EXISTS nsfw_studio_sprites_by_character
            ON nsfw_studio_sprites(character_id, created_at);

          CREATE TABLE IF NOT EXISTS nsfw_studio_places (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            setting TEXT NOT NULL,
            era TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (owner_user_id) REFERENCES nsfw_users(id)
          ) STRICT;

          CREATE TABLE IF NOT EXISTS nsfw_studio_place_backgrounds (
            id TEXT PRIMARY KEY,
            place_id TEXT NOT NULL,
            owner_user_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            mime_type TEXT NOT NULL,
            data BLOB,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (place_id) REFERENCES nsfw_studio_places(id) ON DELETE CASCADE
          ) STRICT;

          CREATE TABLE IF NOT EXISTS nsfw_studio_experiences (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT NOT NULL,
            title TEXT NOT NULL,
            premise TEXT NOT NULL,
            slots_json TEXT NOT NULL,
            adult_profile TEXT NOT NULL,
            plan_seeds_json TEXT NOT NULL,
            endings_json TEXT NOT NULL,
            published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (owner_user_id) REFERENCES nsfw_users(id)
          ) STRICT;

          CREATE TABLE IF NOT EXISTS nsfw_taxonomy_terms (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL UNIQUE COLLATE NOCASE,
            kind TEXT NOT NULL CHECK (kind IN ('interest', 'exclusion', 'setting', 'era', 'other')),
            status TEXT NOT NULL CHECK (status IN ('approved', 'proposed', 'discarded')),
            proposed_by TEXT,
            created_at INTEGER NOT NULL
          ) STRICT;

          CREATE TABLE IF NOT EXISTS nsfw_publications (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT NOT NULL,
            resource_type TEXT NOT NULL CHECK (resource_type IN ('character', 'place', 'experience', 'story')),
            resource_id TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('published', 'withdrawn')),
            snapshot_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (owner_user_id) REFERENCES nsfw_users(id)
          ) STRICT;
          CREATE INDEX IF NOT EXISTS nsfw_publications_by_status
            ON nsfw_publications(status, updated_at DESC);

          CREATE TABLE IF NOT EXISTS nsfw_library_entries (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT NOT NULL,
            publication_id TEXT NOT NULL,
            resource_type TEXT NOT NULL,
            title TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE (owner_user_id, publication_id),
            FOREIGN KEY (owner_user_id) REFERENCES nsfw_users(id),
            FOREIGN KEY (publication_id) REFERENCES nsfw_publications(id)
          ) STRICT;

          CREATE TABLE IF NOT EXISTS nsfw_follows (
            follower_user_id TEXT NOT NULL,
            followed_user_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (follower_user_id, followed_user_id)
          ) STRICT;

          CREATE TABLE IF NOT EXISTS nsfw_ratings (
            id TEXT PRIMARY KEY,
            publication_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
            dimensions_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE (publication_id, user_id)
          ) STRICT;

          CREATE TABLE IF NOT EXISTS nsfw_comments (
            id TEXT PRIMARY KEY,
            publication_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            body TEXT NOT NULL,
            hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
            created_at INTEGER NOT NULL
          ) STRICT;
        `)
      }

      if (version.user_version < 13) {
        const attemptColumns = new Set(
          (
            this.database
              .prepare('PRAGMA table_info(nsfw_generation_attempts)')
              .all() as Array<{ name: string }>
          ).map((column) => column.name)
        )
        if (!attemptColumns.has('skill_versions_json')) {
          this.database.exec(`
            ALTER TABLE nsfw_generation_attempts
              ADD COLUMN skill_versions_json TEXT NOT NULL DEFAULT '{}';
          `)
        }
        if (!attemptColumns.has('pipeline_passes_json')) {
          this.database.exec(`
            ALTER TABLE nsfw_generation_attempts
              ADD COLUMN pipeline_passes_json TEXT NOT NULL DEFAULT '[]';
          `)
        }
        if (!attemptColumns.has('latency_ms')) {
          this.database.exec(`
            ALTER TABLE nsfw_generation_attempts
              ADD COLUMN latency_ms INTEGER NOT NULL DEFAULT 0;
          `)
        }
        if (!attemptColumns.has('thumb')) {
          this.database.exec(`
            ALTER TABLE nsfw_generation_attempts
              ADD COLUMN thumb TEXT;
          `)
        }

        this.database.exec(`
          CREATE TABLE IF NOT EXISTS nsfw_product_feedback (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('bug', 'suggestion', 'checkpoint', 'survey', 'thumb')),
            session_id TEXT,
            attempt_id TEXT,
            score INTEGER,
            body TEXT NOT NULL,
            metadata_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES nsfw_users(id)
          ) STRICT;
          CREATE INDEX IF NOT EXISTS nsfw_product_feedback_by_created
            ON nsfw_product_feedback(created_at DESC);

          CREATE TABLE IF NOT EXISTS nsfw_self_insert_profiles (
            user_id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            pronouns TEXT NOT NULL,
            appearance TEXT NOT NULL,
            boundaries_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES nsfw_users(id)
          ) STRICT;
        `)
      }

      if (version.user_version < 14) {
        this.database.exec(`
          CREATE TABLE IF NOT EXISTS nsfw_collections (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT NOT NULL,
            title TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('user', 'editorial')),
            summary TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (owner_user_id) REFERENCES nsfw_users(id)
          ) STRICT;

          CREATE TABLE IF NOT EXISTS nsfw_collection_entries (
            collection_id TEXT NOT NULL,
            publication_id TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (collection_id, publication_id),
            FOREIGN KEY (collection_id) REFERENCES nsfw_collections(id) ON DELETE CASCADE,
            FOREIGN KEY (publication_id) REFERENCES nsfw_publications(id)
          ) STRICT;

          CREATE TABLE IF NOT EXISTS nsfw_scene_cgs (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT NOT NULL,
            title TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (owner_user_id) REFERENCES nsfw_users(id)
          ) STRICT;

          CREATE TABLE IF NOT EXISTS nsfw_seen_cgs (
            session_id TEXT NOT NULL,
            cg_id TEXT NOT NULL,
            seen_at INTEGER NOT NULL,
            PRIMARY KEY (session_id, cg_id),
            FOREIGN KEY (session_id) REFERENCES nsfw_story_sessions(id) ON DELETE CASCADE
          ) STRICT;
        `)
      }

      if (version.user_version < 15) {
        const sessionColumns = new Set(
          (
            this.database
              .prepare('PRAGMA table_info(nsfw_story_sessions)')
              .all() as Array<{ name: string }>
          ).map((column) => column.name)
        )
        if (!sessionColumns.has('asset_pins_json')) {
          this.database.exec(`
            ALTER TABLE nsfw_story_sessions
              ADD COLUMN asset_pins_json TEXT NOT NULL DEFAULT '{}';
          `)
        }
        if (!sessionColumns.has('escalation_heart')) {
          this.database.exec(`
            ALTER TABLE nsfw_story_sessions
              ADD COLUMN escalation_heart INTEGER NOT NULL DEFAULT 0 CHECK (escalation_heart IN (0, 1));
          `)
        }
        if (!sessionColumns.has('experience_id')) {
          this.database.exec(`
            ALTER TABLE nsfw_story_sessions
              ADD COLUMN experience_id TEXT;
          `)
        }
      }

      if (version.user_version < 16) {
        const profileColumns = new Set(
          (
            this.database
              .prepare('PRAGMA table_info(nsfw_self_insert_profiles)')
              .all() as Array<{ name: string }>
          ).map((column) => column.name)
        )
        if (!profileColumns.has('adult_defaults_json')) {
          this.database.exec(`
            ALTER TABLE nsfw_self_insert_profiles
              ADD COLUMN adult_defaults_json TEXT NOT NULL DEFAULT '{}';
          `)
        }
      }

      if (version.user_version < 17) {
        this.database.exec(`
          CREATE TABLE IF NOT EXISTS nsfw_private_terms (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT NOT NULL,
            label TEXT NOT NULL COLLATE NOCASE,
            kind TEXT NOT NULL DEFAULT 'interest'
              CHECK (kind IN ('interest', 'exclusion', 'setting', 'era', 'other')),
            created_at INTEGER NOT NULL,
            UNIQUE (owner_user_id, label COLLATE NOCASE),
            FOREIGN KEY (owner_user_id) REFERENCES nsfw_users(id) ON DELETE CASCADE
          ) STRICT;
          CREATE INDEX IF NOT EXISTS nsfw_private_terms_by_owner
            ON nsfw_private_terms(owner_user_id, label COLLATE NOCASE);
        `)
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
                'SELECT scope, id, character_id, tags_json, description, is_default, mime_type, created_at FROM images WHERE scope = ? AND character_id = ? ORDER BY created_at'
              )
              .all(scope, query.characterId)
          : this.database
              .prepare(
                'SELECT scope, id, character_id, tags_json, description, is_default, mime_type, created_at FROM images WHERE scope = ? ORDER BY created_at'
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
      case 'presets':
        return (this.database
          .prepare('SELECT * FROM presets WHERE scope = ? ORDER BY created_at')
          .all(scope) as SqliteRow[]).map(rowToPreset)
    }
  }

  get(resource: DataResource, scope: DataScope, id: string) {
    const table = resource === 'llmDebugTraces' ? 'llm_debug_traces' : resource
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
        createdAt: now,
        updatedAt: now
      })
      const sourceImages = this.database
        .prepare(`
          SELECT tags_json, description, is_default, mime_type, created_at, blob_id
          FROM images
          WHERE scope = ? AND character_id = ?
          ORDER BY created_at, id
        `)
        .all(scope, sourceId) as Array<{
        tags_json: string
        description: string
        is_default: number
        mime_type: string
        created_at: number
        blob_id: string
      }>
      const insertImage = this.database.prepare(`
        INSERT INTO images(
          scope, id, character_id, tags_json, description, is_default,
          mime_type, created_at, blob_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const image of sourceImages) {
        insertImage.run(
          scope,
          randomUUID(),
          characterId,
          image.tags_json,
          image.description,
          image.is_default,
          image.mime_type,
          image.created_at,
          image.blob_id
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
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      })

      const insertBlob = this.database.prepare(
        'INSERT INTO image_blobs(scope, id, data) VALUES (?, ?, ?)'
      )
      const insertImage = this.database.prepare(`
        INSERT INTO images(
          scope, id, character_id, tags_json, description, is_default,
          mime_type, created_at, blob_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          text(image.metadata.description),
          bool(image.metadata.isDefault),
          text(image.metadata.mimeType),
          now + index,
          imageId
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

  put(
    resource: Exclude<DataResource, 'images' | 'backgrounds' | 'sounds'>,
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
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scope, id) DO UPDATE SET
              name = excluded.name,
              prompt = excluded.prompt,
              tags_json = excluded.tags_json,
              color = excluded.color,
              image_generation_preset = excluded.image_generation_preset,
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
              pending_image_instructions_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    return this.get(resource, scope, id)
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
            SELECT images.blob_id, image_blobs.data
            FROM images
            INNER JOIN image_blobs
              ON image_blobs.scope = images.scope AND image_blobs.id = images.blob_id
            WHERE images.scope = ? AND images.id = ?
          `)
          .get(scope, id) as { blob_id: string; data: Uint8Array } | undefined
        const blobId = current && sameBinary(current.data, payload.data)
          ? current.blob_id
          : current
            ? randomUUID()
            : id
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
              scope, id, character_id, tags_json, description, is_default,
              mime_type, created_at, blob_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scope, id) DO UPDATE SET
              character_id = excluded.character_id,
              tags_json = excluded.tags_json,
              description = excluded.description,
              is_default = excluded.is_default,
              mime_type = excluded.mime_type,
              created_at = excluded.created_at,
              blob_id = excluded.blob_id
          `)
          .run(
            scope,
            id,
            characterId,
            json(tags(value.tags)),
            text(value.description),
            bool(isDefault),
            text(value.mimeType, 'application/octet-stream'),
            integer(value.createdAt),
            blobId
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
    const table = resource === 'llmDebugTraces' ? 'llm_debug_traces' : resource
    this.database.prepare(`DELETE FROM ${table} WHERE scope = ? AND id = ?`).run(scope, id)
  }

  deleteMessages(scope: DataScope, ids: string[]) {
    if (ids.length === 0) return
    this.transaction(() => {
      const deleteMessage = this.database.prepare('DELETE FROM messages WHERE scope = ? AND id = ?')
      for (const id of ids) deleteMessage.run(scope, id)

      const traces = this.database
        .prepare('SELECT id, status, request_message_id, response_message_id FROM llm_debug_traces WHERE scope = ?')
        .all(scope) as Array<{
        id: string
        status: 'success' | 'error'
        request_message_id: string | null
        response_message_id: string | null
      }>
      const idSet = new Set(ids)
      const deleteTrace = this.database.prepare(
        'DELETE FROM llm_debug_traces WHERE scope = ? AND id = ?'
      )
      for (const trace of traces) {
        if (
          (trace.response_message_id && idSet.has(trace.response_message_id)) ||
          (trace.status === 'error' &&
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
        'llm_debug_traces',
        'messages',
        'stories',
        'sounds',
        'images',
        'image_blobs',
        'characters',
        'backgrounds',
        'presets'
      ]) {
        this.database.prepare(`DELETE FROM ${table} WHERE scope = ?`).run(scope)
      }
    })
  }

  readSettings(): SettingsRow | null {
    const row = this.database
      .prepare("SELECT value_json, api_key, swarm_auth_token FROM settings WHERE key = 'app'")
      .get() as { value_json: string; api_key: string; swarm_auth_token: string } | undefined
    if (!row) return null
    return {
      value: parseJson(row.value_json, {}),
      apiKey: row.api_key,
      swarmAuthToken: row.swarm_auth_token
    }
  }

  writeSettings(patchValue: unknown) {
    const patch = record(patchValue)
    const current = this.readSettings() ?? { value: {}, apiKey: '', swarmAuthToken: '' }
    const nextValue = { ...current.value }
    let nextApiKey = current.apiKey
    let nextSwarmAuthToken = current.swarmAuthToken
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'apiKey') nextApiKey = text(value).trim()
      else if (key === 'swarmAuthToken') nextSwarmAuthToken = text(value).trim()
      else if (key !== 'apiKeyConfigured' && key !== 'swarmAuthConfigured') nextValue[key] = value
    }
    this.database
      .prepare(`
        INSERT INTO settings(key, value_json, api_key, swarm_auth_token) VALUES ('app', ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          api_key = excluded.api_key,
          swarm_auth_token = excluded.swarm_auth_token
      `)
      .run(json(nextValue), nextApiKey, nextSwarmAuthToken)
    return {
      value: nextValue,
      apiKey: nextApiKey,
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
