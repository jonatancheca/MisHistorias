import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type DataScope = 'normal' | 'private'
export type DataResource =
  | 'characters'
  | 'images'
  | 'backgrounds'
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

interface SettingsRow {
  value: Record<string, unknown>
  apiKey: string
}

interface SqliteRow extends Record<string, unknown> {
  id: string
  scope: DataScope
}

const SCHEMA_VERSION = 4
const DEFAULT_DATABASE_PATH = '.data/mishistorias.sqlite'

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
    mkdirSync(dirname(path), { recursive: true })
    this.database = new DatabaseSync(path, { timeout: 5000 })
    this.database.exec('PRAGMA foreign_keys = ON')
    this.database.exec('PRAGMA journal_mode = WAL')
    this.database.exec('PRAGMA synchronous = FULL')
    this.database.exec('PRAGMA busy_timeout = 5000')
    this.migrate()
  }

  private migrate() {
    const version = this.database.prepare('PRAGMA user_version').get() as { user_version: number }
    if (version.user_version >= SCHEMA_VERSION) return

    this.transaction(() => {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS characters (
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
          api_key TEXT NOT NULL DEFAULT ''
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

  getBinary(resource: 'images' | 'backgrounds', scope: DataScope, id: string) {
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
      : this.database
          .prepare('SELECT mime_type, data FROM backgrounds WHERE scope = ? AND id = ?')
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

  put(
    resource: Exclude<DataResource, 'images' | 'backgrounds'>,
    scope: DataScope,
    id: string,
    rawValue: unknown
  ) {
    const value = record(rawValue)
    switch (resource) {
      case 'characters':
        this.database
          .prepare(`
            INSERT INTO characters(scope, id, name, prompt, tags_json, color, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scope, id) DO UPDATE SET
              name = excluded.name,
              prompt = excluded.prompt,
              tags_json = excluded.tags_json,
              color = excluded.color,
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
              initial_background_id, preset_id, image_catalog_snapshot_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    resource: 'images' | 'backgrounds',
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

    return this.transaction(() => {
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
      .prepare("SELECT value_json, api_key FROM settings WHERE key = 'app'")
      .get() as { value_json: string; api_key: string } | undefined
    if (!row) return null
    return { value: parseJson(row.value_json, {}), apiKey: row.api_key }
  }

  writeSettings(patchValue: unknown) {
    const patch = record(patchValue)
    const current = this.readSettings() ?? { value: {}, apiKey: '' }
    const nextValue = { ...current.value }
    let nextApiKey = current.apiKey
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'apiKey') nextApiKey = text(value).trim()
      else if (key !== 'apiKeyConfigured') nextValue[key] = value
    }
    this.database
      .prepare(`
        INSERT INTO settings(key, value_json, api_key) VALUES ('app', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, api_key = excluded.api_key
      `)
      .run(json(nextValue), nextApiKey)
    return { value: nextValue, apiKey: nextApiKey }
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
