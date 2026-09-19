import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { readImageGeneration } from '../../shared/utils/imageGeneration.ts'
import { readStorySwarmError } from '../../shared/utils/swarmError.ts'
import type {
  AccessIdentity,
  DatabaseBackup,
  DatabaseBackupKind,
  IdentityReassignmentCounts,
  IdentityReassignmentPreview,
  IdentityReassignmentRequest,
  IdentityReassignmentResource,
  IdentityReassignmentResult,
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

export interface StorageAccess {
  ownerId: string | null
  includeSharedDemo?: boolean
}

export interface StoredAccessState {
  multiUserEnabled: boolean
  adminOwnerId: string | null
  adminEmail: string | null
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
  imageGenerationModel?: string
  visibleInDemo?: boolean
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

const SCHEMA_VERSION = 37
const DEFAULT_DATABASE_PATH = '.data/mishistorias.sqlite'
const MIGRATION_BACKUP_RETENTION = 5
const OWNED_TABLES = [
  'characters',
  'image_blobs',
  'images',
  'backgrounds',
  'sounds',
  'stories',
  'messages',
  'llm_debug_traces',
  'story_saves',
  'presets',
  'swarm_prompts'
] as const
const IDENTITY_RESOURCE_TABLES = [
  ['characters', 'characters'],
  ['image_blobs', 'imageBlobs'],
  ['images', 'images'],
  ['backgrounds', 'backgrounds'],
  ['sounds', 'sounds'],
  ['stories', 'stories'],
  ['messages', 'messages'],
  ['llm_debug_traces', 'llmDebugTraces'],
  ['story_saves', 'storySaves'],
  ['presets', 'presets'],
  ['swarm_prompts', 'swarmPrompts']
] as const satisfies ReadonlyArray<readonly [typeof OWNED_TABLES[number], IdentityReassignmentResource]>
const PERSONAL_SETTING_KEYS = [
  'theme',
  'responseSpeed',
  'visualNovelManualAdvance',
  'defaultSoundVersion',
  'privateDefaultSoundVersion',
  'userName',
  'privateUserName',
  'userColor',
  'protagonistPreferences',
  'privateProtagonistPreferences'
] as const

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

function cleanIdentity(identity: AccessIdentity): AccessIdentity {
  const id = text(identity.id).trim()
  const email = text(identity.email).trim()
  if (!id || !email) {
    throw Object.assign(new Error('Sub y email son obligatorios para ambas identidades'), {
      code: 'ERR_IDENTITY_INVALID'
    })
  }
  return { id, email }
}

function identityError(code: string, message: string) {
  return Object.assign(new Error(message), { code })
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

function storyWithArchived(value: unknown) {
  const story = storyWithoutImageDescriptions(value)
  return {
    ...story,
    archived: story.archived === true,
    visibleInDemo: story.visibleInDemo === true
  }
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

function storyWithCharacterNames(
  value: unknown,
  nameFor: (characterId: string) => string | undefined
) {
  const story = record(value)
  if (!Array.isArray(story.characterCustomizations)) return story
  return {
    ...story,
    characterCustomizations: story.characterCustomizations.map((item) => {
      const customization = record(item)
      if (typeof customization.characterId !== 'string') return item
      const stored = typeof customization.name === 'string' && customization.name.trim()
        ? customization.name
        : ''
      const name = stored || nameFor(customization.characterId)?.trim() || ''
      return name ? { ...customization, name } : customization
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
    imageGenerationModel: text(row.image_generation_model),
    archived: integer(row.archived) === 1,
    visibleInDemo: integer(row.visible_in_demo) === 1,
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
    style: text(row.style),
    description: text(row.description),
    mimeType: text(row.mime_type, 'application/octet-stream'),
    visibleInDemo: integer(row.visible_in_demo) === 1,
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
    archived: row.archived === 1,
    visibleInDemo: row.visible_in_demo === 1,
    autoGenerateImages: row.auto_generate_images === 1,
    protagonistPreferences: text(row.protagonist_preferences),
    protagonistPreferencesMode:
      row.protagonist_preferences_mode === 'replace' ? 'replace' : 'append',
    characterIds: parseJson<string[]>(row.character_ids_json, []),
    characterCustomizations: parseJson<Story['characterCustomizations']>(row.character_customizations_json, []),
    initialBackgroundId:
      typeof row.initial_background_id === 'string' ? row.initial_background_id : null,
    backgroundStyle: typeof row.background_style === 'string' && row.background_style
      ? row.background_style
      : null,
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
  const swarmError = readStorySwarmError(parseJson(row.swarm_error_json, null))
  return {
    id: row.id,
    storyId: text(row.story_id),
    role: row.role === 'assistant' ? 'assistant' : 'user',
    raw: text(row.raw),
    segments: parseJson<unknown[]>(row.segments_json, []),
    ...(swarmError ? { swarmError } : {}),
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
    story: storyWithArchived(parseJson(row.story_json, {})),
    messages: sanitizeSavedMessages(parseJson(row.messages_json, [])),
    debugTraces: parseJson(row.debug_traces_json, []),
    thumbnailDataUrl: text(row.thumbnail_data_url),
    createdAt: integer(row.created_at)
  }
}

function sanitizeSavedMessages(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((message) => {
    const item = record(message)
    if (item.swarmError === undefined) return item
    return { ...item, swarmError: readStorySwarmError(item.swarmError) }
  })
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

  private nextUploadedBackupPath(name: string) {
    const backupDirectory = this.backupDirectory()
    const databaseName = this.databaseName()
    const originalStem = Array.from(parse(basename(name)).name)
      .map(character => character.charCodeAt(0) < 32 ? '-' : character)
      .join('')
      .normalize('NFKC')
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'backup'
    const stem = `${databaseName}.uploaded-${originalStem}`
    let backupPath = join(backupDirectory, `${stem}.sqlite`)
    let collision = 1
    while (existsSync(backupPath)) {
      backupPath = join(backupDirectory, `${stem}-${collision}.sqlite`)
      collision += 1
    }
    return { backupDirectory, backupPath }
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
      const applicationTables = backupDatabase
        .prepare(`
          SELECT COUNT(*) AS total
          FROM sqlite_schema
          WHERE type = 'table' AND name IN (
            'characters', 'image_blobs', 'images', 'backgrounds', 'sounds', 'stories',
            'messages', 'llm_debug_traces', 'story_saves', 'presets', 'settings', 'swarm_prompts'
          )
        `)
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
        schemaVersion,
        applicationDatabase: applicationTables.total > 0
      }
    } catch {
      return { valid: false, schemaVersion: null, applicationDatabase: false }
    } finally {
      if (backupDatabase?.isOpen) backupDatabase.close()
    }
  }

  private backupKind(name: string): DatabaseBackupKind {
    if (name.startsWith(`${this.databaseName()}.manual-`)) return 'manual'
    if (name.startsWith(`${this.databaseName()}.uploaded-`)) return 'uploaded'
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
      schemaVersion: validation.schemaVersion,
      valid: validation.valid && validation.applicationDatabase
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

  importBackup(sourcePath: string, originalName: string) {
    if (!originalName.toLowerCase().endsWith('.sqlite')) {
      throw new Error('Selecciona un archivo .sqlite')
    }

    const validation = this.readBackupVersion(sourcePath)
    if (!validation.valid || !validation.applicationDatabase) {
      if (validation.schemaVersion !== null && validation.schemaVersion > SCHEMA_VERSION) {
        throw new Error(
          `El backup usa el esquema v${validation.schemaVersion}; esta versión admite hasta v${SCHEMA_VERSION}`
        )
      }
      throw new Error('El archivo no es un backup SQLite válido de Mis Historias')
    }

    const { backupDirectory, backupPath } = this.nextUploadedBackupPath(originalName)
    const temporaryPath = `${backupPath}.tmp-${randomUUID()}`
    mkdirSync(backupDirectory, { recursive: true })

    try {
      copyFileSync(sourcePath, temporaryPath)
      const copiedValidation = this.readBackupVersion(temporaryPath)
      if (
        !copiedValidation.valid ||
        copiedValidation.schemaVersion !== validation.schemaVersion
      ) {
        throw new Error('El backup subido no superó la validación final')
      }
      renameSync(temporaryPath, backupPath)
      return this.inspectBackup(basename(backupPath), backupPath)
    } catch (caught) {
      rmSync(temporaryPath, { force: true })
      throw caught
    }
  }

  getBackupFile(name: string) {
    const backup = this.listBackups().find((item) => item.name === name)
    if (!backup) throw new Error('Backup no encontrado')
    return {
      backup,
      path: join(this.backupDirectory(), backup.name)
    }
  }

  restoreBackup(name: string) {
    const { backup, path: sourcePath } = this.getBackupFile(name)
    if (!backup.valid || backup.schemaVersion === null) {
      throw new Error('El backup no es válido y no puede restaurarse')
    }

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
          owner_id TEXT,
          id TEXT NOT NULL,
          name TEXT NOT NULL,
          prompt TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          color TEXT NOT NULL,
          image_generation_preset TEXT NOT NULL DEFAULT '',
          image_generation_lora TEXT NOT NULL DEFAULT '',
          image_generation_seed TEXT NOT NULL DEFAULT '',
          image_generation_prompt_prefix TEXT NOT NULL DEFAULT '',
          image_generation_model TEXT NOT NULL DEFAULT '',
          archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
          visible_in_demo INTEGER NOT NULL DEFAULT 0 CHECK (visible_in_demo IN (0, 1)),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (scope, id)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS image_blobs (
          scope TEXT NOT NULL CHECK (scope IN ('normal', 'private')),
          owner_id TEXT,
          id TEXT NOT NULL,
          data BLOB NOT NULL,
          PRIMARY KEY (scope, id)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS images (
          scope TEXT NOT NULL CHECK (scope IN ('normal', 'private')),
          owner_id TEXT,
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
          owner_id TEXT,
          id TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          style TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          visible_in_demo INTEGER NOT NULL DEFAULT 0 CHECK (visible_in_demo IN (0, 1)),
          created_at INTEGER NOT NULL,
          data BLOB NOT NULL,
          PRIMARY KEY (scope, id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS backgrounds_by_created_at
          ON backgrounds(scope, created_at);

        CREATE TABLE IF NOT EXISTS sounds (
          scope TEXT NOT NULL CHECK (scope IN ('normal', 'private')),
          owner_id TEXT,
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
          owner_id TEXT,
          id TEXT NOT NULL,
          title TEXT NOT NULL,
          premise TEXT NOT NULL,
          visual_mode INTEGER NOT NULL DEFAULT 0 CHECK (visual_mode IN (0, 1)),
          auto_generate_images INTEGER NOT NULL DEFAULT 0 CHECK (auto_generate_images IN (0, 1)),
          archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
          visible_in_demo INTEGER NOT NULL DEFAULT 0 CHECK (visible_in_demo IN (0, 1)),
          protagonist_preferences TEXT NOT NULL,
          protagonist_preferences_mode TEXT NOT NULL CHECK (protagonist_preferences_mode IN ('append', 'replace')),
          character_ids_json TEXT NOT NULL,
          character_customizations_json TEXT NOT NULL,
          initial_background_id TEXT,
          background_style TEXT,
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
          owner_id TEXT,
          id TEXT NOT NULL,
          story_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          raw TEXT NOT NULL,
          segments_json TEXT NOT NULL,
          swarm_error_json TEXT,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (scope, id),
          FOREIGN KEY (scope, story_id) REFERENCES stories(scope, id) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX IF NOT EXISTS messages_by_story
          ON messages(scope, story_id, created_at);

        CREATE TABLE IF NOT EXISTS llm_debug_traces (
          scope TEXT NOT NULL CHECK (scope IN ('normal', 'private')),
          owner_id TEXT,
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
          owner_id TEXT,
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
          owner_id TEXT,
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
          swarm_auth_token TEXT NOT NULL DEFAULT '',
          multi_user_enabled INTEGER NOT NULL DEFAULT 0 CHECK (multi_user_enabled IN (0, 1)),
          admin_owner_id TEXT,
          admin_email TEXT
        ) STRICT;

        CREATE TABLE IF NOT EXISTS user_settings (
          owner_id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          value_json TEXT NOT NULL DEFAULT '{}',
          updated_at INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS access_identities (
          owner_id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS access_identities_by_email
          ON access_identities(email COLLATE NOCASE);

        CREATE TABLE IF NOT EXISTS identity_reassignments (
          id TEXT PRIMARY KEY,
          source_owner_id TEXT NOT NULL,
          source_email TEXT NOT NULL,
          destination_owner_id TEXT NOT NULL,
          destination_email TEXT NOT NULL,
          actor_owner_id TEXT NOT NULL,
          actor_email TEXT NOT NULL,
          affected_json TEXT NOT NULL,
          moved_administrator INTEGER NOT NULL CHECK (moved_administrator IN (0, 1)),
          created_at INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS identity_reassignments_by_created_at
          ON identity_reassignments(created_at DESC);
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
            scope TEXT NOT NULL, owner_id TEXT, id TEXT NOT NULL, name TEXT NOT NULL, prompt TEXT NOT NULL,
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

      if (version.user_version < 29) {
        // Narrative presets are retired. Keep SwarmUI prompts in their own table.
        this.database.exec(`
          DELETE FROM presets;
          UPDATE stories SET preset_id = NULL;
        `)
        const settings = this.database.prepare("SELECT value_json FROM settings WHERE key = 'app'").get() as
          { value_json: string } | undefined
        if (settings) {
          const value = parseJson<Record<string, unknown>>(settings.value_json, {})
          delete value.activePresetId
          delete value.privateActivePresetId
          delete value.defaultPresetVersion
          delete value.privateDefaultPresetVersion
          this.database.prepare("UPDATE settings SET value_json = ? WHERE key = 'app'").run(json(value))
        }
      }

      if (version.user_version < 30) {
        const characterColumns = this.database
          .prepare('PRAGMA table_info(characters)')
          .all() as Array<{ name: string }>
        if (!characterColumns.some((column) => column.name === 'image_generation_model')) {
          this.database.exec(
            "ALTER TABLE characters ADD COLUMN image_generation_model TEXT NOT NULL DEFAULT ''"
          )
        }
        const storyColumns = this.database
          .prepare('PRAGMA table_info(stories)')
          .all() as Array<{ name: string }>
        if (!storyColumns.some((column) => column.name === 'auto_generate_images')) {
          this.database.exec(
            'ALTER TABLE stories ADD COLUMN auto_generate_images INTEGER NOT NULL DEFAULT 0 CHECK (auto_generate_images IN (0, 1))'
          )
        }
      }

      if (version.user_version < 31) {
        const columns = this.database.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
        if (!columns.some((column) => column.name === 'swarm_error_json')) {
          this.database.exec('ALTER TABLE messages ADD COLUMN swarm_error_json TEXT')
        }
      }

      if (version.user_version < 32) {
        const characterNames = new Map(
          (this.database.prepare('SELECT scope, id, name FROM characters').all() as Array<{
            scope: string
            id: string
            name: string
          }>).map((character) => [`${character.scope}\0${character.id}`, character.name])
        )
        const nameFor = (scope: string, characterId: string) =>
          characterNames.get(`${scope}\0${characterId}`)

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
          const normalized = storyWithCharacterNames(
            { characterCustomizations: parseJson(story.character_customizations_json, []) },
            (characterId) => nameFor(story.scope, characterId)
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
            json(storyWithCharacterNames(
              parseJson(save.story_json, {}),
              (characterId) => nameFor(save.scope, characterId)
            )),
            save.scope,
            save.id
          )
        }
      }

      if (version.user_version < 33) {
        const storyColumns = this.database
          .prepare('PRAGMA table_info(stories)')
          .all() as Array<{ name: string }>
        if (!storyColumns.some((column) => column.name === 'archived')) {
          this.database.exec(
            'ALTER TABLE stories ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))'
          )
        }
      }

      if (version.user_version < 34) {
        const additions = [
          ['characters', 'visible_in_demo'],
          ['backgrounds', 'visible_in_demo'],
          ['stories', 'visible_in_demo']
        ] as const
        for (const [table, column] of additions) {
          const columns = this.database
            .prepare(`PRAGMA table_info(${table})`)
            .all() as Array<{ name: string }>
          if (!columns.some((item) => item.name === column)) {
            this.database.exec(
              `ALTER TABLE ${table} ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0 CHECK (${column} IN (0, 1))`
            )
          }
        }
      }

      if (version.user_version < 35) {
        for (const table of OWNED_TABLES) {
          const columns = this.database
            .prepare(`PRAGMA table_info(${table})`)
            .all() as Array<{ name: string }>
          if (!columns.some((item) => item.name === 'owner_id')) {
            this.database.exec(`ALTER TABLE ${table} ADD COLUMN owner_id TEXT`)
          }
          this.database.exec(
            `CREATE INDEX IF NOT EXISTS ${table}_by_owner_scope ON ${table}(owner_id, scope)`
          )
        }

        const settingsColumns = this.database
          .prepare('PRAGMA table_info(settings)')
          .all() as Array<{ name: string }>
        if (!settingsColumns.some((item) => item.name === 'multi_user_enabled')) {
          this.database.exec(
            'ALTER TABLE settings ADD COLUMN multi_user_enabled INTEGER NOT NULL DEFAULT 0 CHECK (multi_user_enabled IN (0, 1))'
          )
        }
        if (!settingsColumns.some((item) => item.name === 'admin_owner_id')) {
          this.database.exec('ALTER TABLE settings ADD COLUMN admin_owner_id TEXT')
        }
        if (!settingsColumns.some((item) => item.name === 'admin_email')) {
          this.database.exec('ALTER TABLE settings ADD COLUMN admin_email TEXT')
        }
        this.database.exec(`
          CREATE TABLE IF NOT EXISTS user_settings (
            owner_id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            value_json TEXT NOT NULL DEFAULT '{}',
            updated_at INTEGER NOT NULL
          ) STRICT;
        `)
      }

      if (version.user_version < 36) {
        const backgroundColumns = this.database
          .prepare('PRAGMA table_info(backgrounds)')
          .all() as Array<{ name: string }>
        if (!backgroundColumns.some((item) => item.name === 'style')) {
          this.database.exec("ALTER TABLE backgrounds ADD COLUMN style TEXT NOT NULL DEFAULT ''")
        }
        const storyColumns = this.database
          .prepare('PRAGMA table_info(stories)')
          .all() as Array<{ name: string }>
        if (!storyColumns.some((item) => item.name === 'background_style')) {
          this.database.exec('ALTER TABLE stories ADD COLUMN background_style TEXT')
        }
      }

      if (version.user_version < 37) {
        this.database.exec(`
          CREATE TABLE IF NOT EXISTS access_identities (
            owner_id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            first_seen_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL
          ) STRICT;
          CREATE INDEX IF NOT EXISTS access_identities_by_email
            ON access_identities(email COLLATE NOCASE);

          CREATE TABLE IF NOT EXISTS identity_reassignments (
            id TEXT PRIMARY KEY,
            source_owner_id TEXT NOT NULL,
            source_email TEXT NOT NULL,
            destination_owner_id TEXT NOT NULL,
            destination_email TEXT NOT NULL,
            actor_owner_id TEXT NOT NULL,
            actor_email TEXT NOT NULL,
            affected_json TEXT NOT NULL,
            moved_administrator INTEGER NOT NULL CHECK (moved_administrator IN (0, 1)),
            created_at INTEGER NOT NULL
          ) STRICT;
          CREATE INDEX IF NOT EXISTS identity_reassignments_by_created_at
            ON identity_reassignments(created_at DESC);

          INSERT INTO access_identities(owner_id, email, first_seen_at, last_seen_at)
          SELECT owner_id, email, updated_at, updated_at FROM user_settings WHERE 1
          ON CONFLICT(owner_id) DO UPDATE SET
            email = excluded.email,
            last_seen_at = MAX(access_identities.last_seen_at, excluded.last_seen_at);

          INSERT INTO access_identities(owner_id, email, first_seen_at, last_seen_at)
          SELECT admin_owner_id, admin_email, 0, 0 FROM settings
          WHERE key = 'app' AND admin_owner_id IS NOT NULL AND admin_email IS NOT NULL
          ON CONFLICT(owner_id) DO UPDATE SET email = excluded.email;
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

  readAccessState(): StoredAccessState {
    const row = this.database.prepare(`
      SELECT multi_user_enabled, admin_owner_id, admin_email
      FROM settings WHERE key = 'app'
    `).get() as {
      multi_user_enabled: number
      admin_owner_id: string | null
      admin_email: string | null
    } | undefined
    return {
      multiUserEnabled: row?.multi_user_enabled === 1,
      adminOwnerId: row?.admin_owner_id ?? null,
      adminEmail: row?.admin_email ?? null
    }
  }

  activateMultiUser(identity: AccessIdentity) {
    return this.transaction(() => {
      identity = cleanIdentity(identity)
      this.rememberAccessIdentity(identity)
      const current = this.readAccessState()
      if (current.multiUserEnabled) return { state: current, claimed: {} as Record<string, number> }

      this.database.prepare(`
        INSERT INTO settings(
          key, value_json, api_key, private_api_key, swarm_auth_token,
          multi_user_enabled, admin_owner_id, admin_email
        ) VALUES ('app', '{}', '', '', '', 0, NULL, NULL)
        ON CONFLICT(key) DO NOTHING
      `).run()

      const claimed: Record<string, number> = {}
      for (const table of OWNED_TABLES) {
        const result = this.database
          .prepare(`UPDATE ${table} SET owner_id = ? WHERE owner_id IS NULL`)
          .run(identity.id)
        claimed[table] = Number(result.changes)
      }

      const settings = this.readSettings()?.value ?? {}
      const personal = Object.fromEntries(
        PERSONAL_SETTING_KEYS.flatMap((key) => Object.hasOwn(settings, key) ? [[key, settings[key]]] : [])
      )
      const globalSettings = { ...settings }
      for (const key of PERSONAL_SETTING_KEYS) Reflect.deleteProperty(globalSettings, key)
      this.database.prepare(
        "UPDATE settings SET value_json = ? WHERE key = 'app'"
      ).run(json(globalSettings))
      this.database.prepare(`
        INSERT INTO user_settings(owner_id, email, value_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(owner_id) DO UPDATE SET
          email = excluded.email,
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `).run(identity.id, identity.email, json(personal), Date.now())
      this.database.prepare(`
        UPDATE settings SET multi_user_enabled = 1, admin_owner_id = ?, admin_email = ?
        WHERE key = 'app'
      `).run(identity.id, identity.email)
      return { state: this.readAccessState(), claimed }
    })
  }

  readUserSettings(ownerId: string) {
    const row = this.database.prepare(
      'SELECT value_json FROM user_settings WHERE owner_id = ?'
    ).get(ownerId) as { value_json: string } | undefined
    return parseJson<Record<string, unknown>>(row?.value_json, {})
  }

  writeUserSettings(identity: AccessIdentity, patchValue: unknown) {
    identity = cleanIdentity(identity)
    this.rememberAccessIdentity(identity)
    const patch = record(patchValue)
    const current = this.readUserSettings(identity.id)
    const next = { ...current }
    for (const key of PERSONAL_SETTING_KEYS) {
      if (Object.hasOwn(patch, key)) next[key] = patch[key]
    }
    this.database.prepare(`
      INSERT INTO user_settings(owner_id, email, value_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET
        email = excluded.email,
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run(identity.id, identity.email, json(next), Date.now())
    return next
  }

  rememberAccessIdentity(rawIdentity: AccessIdentity, seenAt = Date.now()) {
    const identity = cleanIdentity(rawIdentity)
    const previous = this.database.prepare(`
      SELECT email, last_seen_at FROM access_identities WHERE owner_id = ?
    `).get(identity.id) as { email: string; last_seen_at: number } | undefined
    if (
      previous &&
      previous.email === identity.email &&
      previous.last_seen_at > seenAt - 60 * 60 * 1000
    ) {
      return identity
    }
    this.database.prepare(`
      INSERT INTO access_identities(owner_id, email, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET
        email = excluded.email,
        last_seen_at = excluded.last_seen_at
    `).run(identity.id, identity.email, seenAt, seenAt)
    return identity
  }

  private knownIdentityEmail(ownerId: string) {
    const observed = this.database.prepare(
      'SELECT email FROM access_identities WHERE owner_id = ?'
    ).get(ownerId) as { email: string } | undefined
    if (observed?.email) return observed.email

    const settings = this.database.prepare(
      'SELECT email FROM user_settings WHERE owner_id = ?'
    ).get(ownerId) as { email: string } | undefined
    if (settings?.email) return settings.email

    const administrator = this.database.prepare(`
      SELECT admin_email AS email FROM settings
      WHERE key = 'app' AND admin_owner_id = ?
    `).get(ownerId) as { email: string | null } | undefined
    return administrator?.email ?? null
  }

  private identityCounts(ownerId: string): IdentityReassignmentCounts {
    const scopeCounts = (scope: DataScope) => Object.fromEntries(
      IDENTITY_RESOURCE_TABLES.map(([table, resource]) => {
        const row = this.database.prepare(
          `SELECT COUNT(*) AS total FROM ${table} WHERE owner_id = ? AND scope = ?`
        ).get(ownerId, scope) as { total: number }
        return [resource, Number(row.total)]
      })
    ) as Record<IdentityReassignmentResource, number>
    const normal = scopeCounts('normal')
    const privateScope = scopeCounts('private')
    const userSettings = Number((this.database.prepare(
      'SELECT COUNT(*) AS total FROM user_settings WHERE owner_id = ?'
    ).get(ownerId) as { total: number }).total)
    const total = [...Object.values(normal), ...Object.values(privateScope), userSettings]
      .reduce((sum, count) => sum + count, 0)
    return { normal, private: privateScope, userSettings, total }
  }

  private identityPreviewFingerprint(
    source: AccessIdentity,
    destination: AccessIdentity,
    affected: IdentityReassignmentCounts,
    movesAdministrator: boolean
  ) {
    return createHash('sha256').update(json({
      source,
      destination,
      affected,
      movesAdministrator
    })).digest('hex')
  }

  private buildIdentityReassignmentPreview(
    rawRequest: IdentityReassignmentRequest
  ): IdentityReassignmentPreview {
    let source = cleanIdentity(rawRequest.source)
    let destination = cleanIdentity(rawRequest.destination)
    if (source.id === destination.id) {
      throw identityError('ERR_IDENTITY_SAME', 'Origen y destino tienen el mismo sub')
    }

    const sourceEmail = this.knownIdentityEmail(source.id)
    if (sourceEmail && sourceEmail.localeCompare(source.email, undefined, { sensitivity: 'accent' }) !== 0) {
      throw identityError(
        'ERR_IDENTITY_EMAIL_MISMATCH',
        'El email no coincide con la identidad de origen registrada'
      )
    }
    const destinationEmail = this.knownIdentityEmail(destination.id)
    if (!destinationEmail) {
      throw identityError(
        'ERR_IDENTITY_DESTINATION_UNKNOWN',
        'La identidad de destino debe entrar en la aplicación al menos una vez'
      )
    }
    if (destinationEmail.localeCompare(destination.email, undefined, { sensitivity: 'accent' }) !== 0) {
      throw identityError(
        'ERR_IDENTITY_EMAIL_MISMATCH',
        'El email no coincide con la identidad de destino registrada'
      )
    }
    source = { ...source, email: sourceEmail ?? source.email }
    destination = { ...destination, email: destinationEmail }

    const affected = this.identityCounts(source.id)
    const accessState = this.readAccessState()
    const movesAdministrator = accessState.adminOwnerId === source.id
    if (affected.total === 0 && !movesAdministrator) {
      throw identityError(
        'ERR_IDENTITY_SOURCE_EMPTY',
        'La identidad de origen no tiene datos que reasignar'
      )
    }
    if (this.identityCounts(destination.id).total > 0) {
      throw identityError(
        'ERR_IDENTITY_DESTINATION_CONFLICT',
        'La identidad de destino ya tiene datos; no se pueden mezclar propietarios'
      )
    }

    return {
      source,
      destination,
      affected,
      movesAdministrator,
      fingerprint: this.identityPreviewFingerprint(
        source,
        destination,
        affected,
        movesAdministrator
      )
    }
  }

  previewIdentityReassignment(request: IdentityReassignmentRequest) {
    return this.transaction(() => this.buildIdentityReassignmentPreview(request))
  }

  reassignIdentity(
    request: IdentityReassignmentRequest,
    rawActor: AccessIdentity,
    expectedFingerprint: string
  ): IdentityReassignmentResult {
    const actor = cleanIdentity(rawActor)
    return this.transaction(() => {
      const preview = this.buildIdentityReassignmentPreview(request)
      if (!expectedFingerprint || preview.fingerprint !== expectedFingerprint) {
        throw identityError(
          'ERR_IDENTITY_PREVIEW_STALE',
          'Los datos cambiaron desde la previsualización; vuelve a revisarla'
        )
      }

      for (const [table, resource] of IDENTITY_RESOURCE_TABLES) {
        const moved = Number(this.database.prepare(
          `UPDATE ${table} SET owner_id = ? WHERE owner_id = ?`
        ).run(preview.destination.id, preview.source.id).changes)
        const expected = preview.affected.normal[resource] + preview.affected.private[resource]
        if (moved !== expected) {
          throw identityError(
            'ERR_IDENTITY_PREVIEW_STALE',
            'Los datos cambiaron durante la reasignación; no se aplicó ningún cambio'
          )
        }
      }

      const movedSettings = Number(this.database.prepare(`
        UPDATE user_settings SET owner_id = ?, email = ?, updated_at = ?
        WHERE owner_id = ?
      `).run(preview.destination.id, preview.destination.email, Date.now(), preview.source.id).changes)
      if (movedSettings !== preview.affected.userSettings) {
        throw identityError(
          'ERR_IDENTITY_PREVIEW_STALE',
          'Los ajustes cambiaron durante la reasignación; no se aplicó ningún cambio'
        )
      }

      if (preview.movesAdministrator) {
        this.database.prepare(`
          UPDATE settings SET admin_owner_id = ?, admin_email = ?
          WHERE key = 'app' AND admin_owner_id = ?
        `).run(preview.destination.id, preview.destination.email, preview.source.id)
      }

      const auditId = randomUUID()
      const completedAt = Date.now()
      this.database.prepare(`
        INSERT INTO identity_reassignments(
          id, source_owner_id, source_email, destination_owner_id, destination_email,
          actor_owner_id, actor_email, affected_json, moved_administrator, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        auditId,
        preview.source.id,
        preview.source.email,
        preview.destination.id,
        preview.destination.email,
        actor.id,
        actor.email,
        json(preview.affected),
        bool(preview.movesAdministrator),
        completedAt
      )

      return { auditId, completedAt, preview }
    })
  }

  private withReadOnly<T>(value: T, row: SqliteRow, access?: StorageAccess): T {
    if (!access?.ownerId || row.owner_id === access.ownerId) return value
    return { ...value, readOnly: true }
  }

  private ownsRow(table: string, scope: DataScope, id: string, access?: StorageAccess) {
    if (!access) return true
    const row = this.database.prepare(
      `SELECT owner_id FROM ${table} WHERE scope = ? AND id = ?`
    ).get(scope, id) as { owner_id: string | null } | undefined
    if (!row) return true
    return row.owner_id === access.ownerId
  }

  private assertWritable(table: string, scope: DataScope, id: string, access?: StorageAccess) {
    if (!this.ownsRow(table, scope, id, access)) {
      throw Object.assign(new Error('El recurso pertenece a otro usuario'), {
        code: 'ERR_READ_ONLY_RESOURCE'
      })
    }
  }

  private accessFilter(resource: DataResource, alias: string, access?: StorageAccess) {
    if (!access) return { sql: '', args: [] as unknown[] }
    if (!access.ownerId) return { sql: ` AND ${alias}.owner_id IS NULL`, args: [] as unknown[] }
    const own = `${alias}.owner_id = ?`
    if (!access.includeSharedDemo) return { sql: ` AND ${own}`, args: [access.ownerId] }
    if (resource === 'stories') {
      return {
        sql: ` AND (${own} OR ${alias}.visible_in_demo = 1)`,
        args: [access.ownerId]
      }
    }
    if (resource === 'characters') {
      return {
        sql: ` AND (${own} OR ${alias}.visible_in_demo = 1 OR EXISTS (
          SELECT 1 FROM stories shared_story, json_each(shared_story.character_ids_json) character_id
          WHERE shared_story.scope = ${alias}.scope
            AND shared_story.visible_in_demo = 1
            AND character_id.value = ${alias}.id
        ))`,
        args: [access.ownerId]
      }
    }
    if (resource === 'backgrounds') {
      return {
        sql: ` AND (${own} OR ${alias}.visible_in_demo = 1 OR EXISTS (
          SELECT 1 FROM stories shared_story
          WHERE shared_story.scope = ${alias}.scope
            AND shared_story.visible_in_demo = 1
            AND shared_story.initial_background_id = ${alias}.id
        ) OR EXISTS (
          SELECT 1 FROM messages shared_message
          INNER JOIN stories shared_story
            ON shared_story.scope = shared_message.scope AND shared_story.id = shared_message.story_id,
            json_each(shared_message.segments_json) segment
          WHERE shared_message.scope = ${alias}.scope
            AND shared_story.visible_in_demo = 1
            AND json_extract(segment.value, '$.backgroundId') = ${alias}.id
        ))`,
        args: [access.ownerId]
      }
    }
    if (resource === 'images') {
      return {
        sql: ` AND (${own} OR EXISTS (
          SELECT 1 FROM characters shared_character
          WHERE shared_character.scope = ${alias}.scope
            AND shared_character.id = ${alias}.character_id
            AND (shared_character.visible_in_demo = 1 OR EXISTS (
              SELECT 1 FROM stories shared_story, json_each(shared_story.character_ids_json) character_id
              WHERE shared_story.scope = shared_character.scope
                AND shared_story.visible_in_demo = 1
                AND character_id.value = shared_character.id
            ))
        ))`,
        args: [access.ownerId]
      }
    }
    if (resource === 'sounds') {
      return {
        sql: ` AND (${own} OR EXISTS (
          SELECT 1 FROM characters shared_character
          WHERE shared_character.scope = ${alias}.scope
            AND shared_character.id = ${alias}.character_id
            AND shared_character.visible_in_demo = 1
        ) OR EXISTS (
          SELECT 1 FROM backgrounds shared_background
          WHERE shared_background.scope = ${alias}.scope
            AND shared_background.id = ${alias}.background_id
            AND shared_background.visible_in_demo = 1
        ) OR EXISTS (
          SELECT 1 FROM messages shared_message
          INNER JOIN stories shared_story
            ON shared_story.scope = shared_message.scope AND shared_story.id = shared_message.story_id,
            json_each(shared_message.segments_json) segment
          WHERE shared_message.scope = ${alias}.scope
            AND shared_story.visible_in_demo = 1
            AND json_extract(segment.value, '$.soundId') = ${alias}.id
        ))`,
        args: [access.ownerId]
      }
    }
    if (resource === 'messages') {
      return {
        sql: ` AND (${own} OR EXISTS (
          SELECT 1 FROM stories shared_story
          WHERE shared_story.scope = ${alias}.scope
            AND shared_story.id = ${alias}.story_id
            AND shared_story.visible_in_demo = 1
        ))`,
        args: [access.ownerId]
      }
    }
    return { sql: ` AND ${own}`, args: [access.ownerId] }
  }

  list<R extends DataResource>(
    resource: R,
    scope: DataScope,
    query?: ResourceQuery,
    access?: StorageAccess
  ): DataRecordMap[R][]
  list(
    resource: DataResource,
    scope: DataScope,
    query: ResourceQuery = {},
    access?: StorageAccess
  ) {
    switch (resource) {
      case 'characters': {
        const filter = this.accessFilter(resource, 'characters', access)
        return (this.database.prepare(
          `SELECT * FROM characters WHERE scope = ?${filter.sql} ORDER BY name COLLATE NOCASE`
        ).all(scope, ...filter.args) as SqliteRow[])
          .map((row) => this.withReadOnly(rowToCharacter(row), row, access))
      }
      case 'images': {
        const filter = this.accessFilter(resource, 'images', access)
        const rows = query.characterId
          ? this.database
              .prepare(
                `SELECT scope, owner_id, id, character_id, tags_json, is_default, mime_type, created_at, generation_json, original_data IS NOT NULL AS has_original FROM images WHERE scope = ? AND character_id = ?${filter.sql} ORDER BY created_at`
              )
              .all(scope, query.characterId, ...filter.args)
          : this.database
              .prepare(
                `SELECT scope, owner_id, id, character_id, tags_json, is_default, mime_type, created_at, generation_json, original_data IS NOT NULL AS has_original FROM images WHERE scope = ?${filter.sql} ORDER BY created_at`
              )
              .all(scope, ...filter.args)
        return (rows as SqliteRow[])
          .map((row) => this.withReadOnly(rowToImage(row), row, access))
      }
      case 'backgrounds': {
        const filter = this.accessFilter(resource, 'backgrounds', access)
        return (this.database.prepare(
          `SELECT scope, owner_id, id, tags_json, style, description, mime_type, visible_in_demo, created_at FROM backgrounds WHERE scope = ?${filter.sql} ORDER BY created_at`
        ).all(scope, ...filter.args) as SqliteRow[])
          .map((row) => this.withReadOnly(rowToBackground(row), row, access))
      }
      case 'sounds': {
        const filter = this.accessFilter(resource, 'sounds', access)
        return (this.database.prepare(
          `SELECT scope, owner_id, id, tags_json, character_id, background_id, mime_type, created_at FROM sounds WHERE scope = ?${filter.sql} ORDER BY created_at`
        ).all(scope, ...filter.args) as SqliteRow[])
          .map((row) => this.withReadOnly(rowToSound(row), row, access))
      }
      case 'stories': {
        const filter = this.accessFilter(resource, 'stories', access)
        return (this.database.prepare(
          `SELECT * FROM stories WHERE scope = ?${filter.sql} ORDER BY updated_at DESC`
        ).all(scope, ...filter.args) as SqliteRow[])
          .map((row) => this.withReadOnly(rowToStory(row), row, access))
      }
      case 'messages': {
        const filter = this.accessFilter(resource, 'messages', access)
        return (this.database.prepare(
          `SELECT * FROM messages WHERE scope = ? AND story_id = ?${filter.sql} ORDER BY created_at`
        ).all(scope, query.storyId ?? '', ...filter.args) as SqliteRow[])
          .map((row) => this.withReadOnly(rowToMessage(row), row, access))
      }
      case 'llmDebugTraces': {
        const filter = this.accessFilter(resource, 'llm_debug_traces', access)
        return (this.database.prepare(
          `SELECT * FROM llm_debug_traces WHERE scope = ? AND story_id = ?${filter.sql} ORDER BY created_at`
        ).all(scope, query.storyId ?? '', ...filter.args) as SqliteRow[]).map(rowToTrace)
      }
      case 'storySaves': {
        const filter = this.accessFilter(resource, 'story_saves', access)
        return (this.database.prepare(
          `SELECT * FROM story_saves WHERE scope = ? AND story_id = ?${filter.sql} ORDER BY created_at DESC`
        ).all(scope, query.storyId ?? '', ...filter.args) as SqliteRow[]).map(rowToStorySave)
      }
      case 'swarmPrompts': {
        const filter = this.accessFilter(resource, 'swarm_prompts', access)
        return (this.database.prepare(
          `SELECT * FROM swarm_prompts WHERE scope = ?${filter.sql} ORDER BY created_at, rowid`
        ).all(scope, ...filter.args) as SqliteRow[]).map(rowToSwarmPrompt)
      }
      case 'presets': {
        const filter = this.accessFilter(resource, 'presets', access)
        return (this.database.prepare(
          `SELECT * FROM presets WHERE scope = ?${filter.sql} ORDER BY created_at`
        ).all(scope, ...filter.args) as SqliteRow[]).map(rowToPreset)
      }
    }
  }

  get<R extends DataResource>(
    resource: R,
    scope: DataScope,
    id: string,
    access?: StorageAccess
  ): DataRecordMap[R] | null
  get(resource: DataResource, scope: DataScope, id: string, access?: StorageAccess) {
    const table = resource === 'llmDebugTraces'
      ? 'llm_debug_traces'
      : resource === 'storySaves'
        ? 'story_saves'
        : resource === 'swarmPrompts' ? 'swarm_prompts' : resource
    const filter = this.accessFilter(resource, table, access)
    const row = this.database
      .prepare(`SELECT * FROM ${table} WHERE scope = ? AND id = ?${filter.sql}`)
      .get(scope, id, ...filter.args) as SqliteRow | undefined
    if (!row) return null
    switch (resource) {
      case 'characters':
        return this.withReadOnly(rowToCharacter(row), row, access)
      case 'images':
        return this.withReadOnly(rowToImage(row), row, access)
      case 'backgrounds':
        return this.withReadOnly(rowToBackground(row), row, access)
      case 'sounds':
        return this.withReadOnly(rowToSound(row), row, access)
      case 'stories':
        return this.withReadOnly(rowToStory(row), row, access)
      case 'messages':
        return this.withReadOnly(rowToMessage(row), row, access)
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

  getBinary(
    resource: 'images' | 'backgrounds' | 'sounds',
    scope: DataScope,
    id: string,
    access?: StorageAccess
  ) {
    const filter = this.accessFilter(resource, resource, access)
    const row = (resource === 'images'
      ? this.database
          .prepare(`
            SELECT images.mime_type, image_blobs.data
            FROM images
            INNER JOIN image_blobs
              ON image_blobs.scope = images.scope AND image_blobs.id = images.blob_id
            WHERE images.scope = ? AND images.id = ?${filter.sql}
          `)
          .get(scope, id, ...filter.args)
      : resource === 'backgrounds'
        ? this.database
            .prepare(`SELECT mime_type, data FROM backgrounds WHERE scope = ? AND id = ?${filter.sql}`)
            .get(scope, id, ...filter.args)
        : this.database
            .prepare(`SELECT mime_type, data FROM sounds WHERE scope = ? AND id = ?${filter.sql}`)
            .get(scope, id, ...filter.args)) as { mime_type: string; data: Uint8Array } | undefined
    return row ? { mimeType: row.mime_type, data: row.data } : null
  }

  getOriginalImage(scope: DataScope, id: string, access?: StorageAccess) {
    const filter = this.accessFilter('images', 'images', access)
    const row = this.database.prepare(`
      SELECT original_mime_type, original_data FROM images
      WHERE scope = ? AND id = ? AND original_data IS NOT NULL${filter.sql}
    `).get(scope, id, ...filter.args) as { original_mime_type: string; original_data: Uint8Array } | undefined
    return row ? { mimeType: row.original_mime_type, data: row.original_data } : null
  }

  restoreImage(scope: DataScope, id: string, access?: StorageAccess) {
    const original = this.getOriginalImage(scope, id, access)
    const metadata = this.get('images', scope, id, access)
    if (!original || !metadata) return null
    return this.putBinary('images', scope, id, {
      metadata: { ...metadata, mimeType: original.mimeType },
      data: original.data
    }, access)
  }

  copyCharacter(
    scope: DataScope,
    sourceId: string,
    rawValue: unknown,
    access?: StorageAccess
  ) {
    const source = this.get('characters', scope, sourceId, access)
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
        imageGenerationModel:
          typeof value.imageGenerationModel === 'string'
            ? value.imageGenerationModel
            : source.imageGenerationModel,
        archived: false,
        visibleInDemo: Boolean(value.visibleInDemo),
        createdAt: now,
        updatedAt: now
      }, access)
      const sourceImages = this.database
        .prepare(`
          SELECT images.tags_json, images.is_default, images.mime_type, images.created_at,
            image_blobs.data, images.original_data, images.original_mime_type,
            images.generation_json
          FROM images
          INNER JOIN image_blobs
            ON image_blobs.scope = images.scope AND image_blobs.id = images.blob_id
          WHERE images.scope = ? AND images.character_id = ?
          ORDER BY images.created_at, images.id
        `)
        .all(scope, sourceId) as Array<{
        tags_json: string
        is_default: number
        mime_type: string
        created_at: number
        data: Uint8Array
        original_data: Uint8Array | null
        original_mime_type: string | null
        generation_json: string | null
      }>
      const insertBlob = this.database.prepare(`
        INSERT INTO image_blobs(scope, owner_id, id, data) VALUES (?, ?, ?, ?)
      `)
      const insertImage = this.database.prepare(`
        INSERT INTO images(
          scope, owner_id, id, character_id, tags_json, is_default,
          mime_type, created_at, blob_id, original_data, original_mime_type, generation_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const image of sourceImages) {
        const imageId = randomUUID()
        insertBlob.run(scope, access?.ownerId ?? null, imageId, image.data)
        insertImage.run(
          scope,
          access?.ownerId ?? null,
          imageId,
          characterId,
          image.tags_json,
          image.is_default,
          image.mime_type,
          image.created_at,
          imageId,
          image.original_data,
          image.original_mime_type,
          image.generation_json
        )
      }
      return {
        character,
        images: this.list('images', scope, { characterId }, access)
      }
    })
  }

  copyBackground(scope: DataScope, sourceId: string, access: StorageAccess) {
    const source = this.get('backgrounds', scope, sourceId, access)
    const binary = this.getBinary('backgrounds', scope, sourceId, access)
    if (!source || !binary) return null
    const ownAccess = { ownerId: access.ownerId }
    const usedTags = new Set(
      (this.list('backgrounds', scope, {}, ownAccess) as Array<{ tags: string[] }>)
        .flatMap((background) => background.tags)
        .map(tagKey)
    )
    const copiedTags = source.tags.map((tag) => {
      const copied = nextAvailableTag(tag, usedTags)
      usedTags.add(tagKey(copied))
      return copied
    })
    const id = randomUUID()
    return this.putBinary('backgrounds', scope, id, {
      metadata: {
        id,
        tags: copiedTags,
        style: source.style,
        description: source.description,
        mimeType: source.mimeType,
        visibleInDemo: false,
        createdAt: Date.now()
      },
      data: binary.data
    }, ownAccess)
  }

  importCharacter(
    scope: DataScope,
    targetId: string | null,
    payload: CharacterImportPayload,
    access?: StorageAccess
  ) {
    const existing = targetId ? this.get('characters', scope, targetId, access) : null
    if (targetId && !existing) return null
    const characterId = targetId ?? randomUUID()
    const now = Date.now()

    return this.transaction(() => {
      if (targetId) {
        this.assertWritable('characters', scope, characterId, access)
        this.database
          .prepare('DELETE FROM images WHERE scope = ? AND character_id = ? AND owner_id IS ?')
          .run(scope, characterId, access?.ownerId ?? null)
        this.database
          .prepare('DELETE FROM sounds WHERE scope = ? AND character_id = ? AND owner_id IS ?')
          .run(scope, characterId, access?.ownerId ?? null)
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
        imageGenerationModel: payload.imageGenerationModel,
        archived: existing?.archived ?? false,
        visibleInDemo: existing?.visibleInDemo ?? payload.visibleInDemo,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }, access)

      const insertBlob = this.database.prepare(
        'INSERT INTO image_blobs(scope, owner_id, id, data) VALUES (?, ?, ?, ?)'
      )
      const insertImage = this.database.prepare(`
        INSERT INTO images(
          scope, owner_id, id, character_id, tags_json, is_default,
          mime_type, created_at, blob_id, original_data, original_mime_type, generation_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const [index, image] of payload.images.entries()) {
        const imageId = randomUUID()
        const imageTags = tags(image.metadata.tags)
        if (imageTags.length === 0) imageTags.push('neutral')
        insertBlob.run(scope, access?.ownerId ?? null, imageId, image.data)
        insertImage.run(
          scope,
          access?.ownerId ?? null,
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
        (this.list('sounds', scope, {}, access ? { ownerId: access.ownerId } : undefined) as Array<{ tags: string[] }>)
          .flatMap((sound) => sound.tags)
          .map(tagKey)
      )
      const insertSound = this.database.prepare(`
        INSERT INTO sounds(
          scope, owner_id, id, tags_json, character_id, background_id, mime_type, created_at, data
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
      `)
      for (const [index, sound] of payload.sounds.entries()) {
        const soundTags = tags(sound.metadata.tags).map((base) => {
          const available = nextAvailableTag(base, usedSoundTags)
          usedSoundTags.add(tagKey(available))
          return available
        })
        insertSound.run(
          scope,
          access?.ownerId ?? null,
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
        images: this.list('images', scope, { characterId }, access),
        sounds: (this.list('sounds', scope, {}, access) as Array<Record<string, unknown>>)
          .filter((sound) => sound.characterId === characterId)
      }
    })
  }

  put<R extends JsonResource>(
    resource: R,
    scope: DataScope,
    id: string,
    rawValue: unknown,
    access?: StorageAccess
  ): DataRecordMap[R]
  put(
    resource: JsonResource,
    scope: DataScope,
    id: string,
    rawValue: unknown,
    access?: StorageAccess
  ) {
    const value = record(rawValue)
    const table = resource === 'llmDebugTraces'
      ? 'llm_debug_traces'
      : resource === 'storySaves'
        ? 'story_saves'
        : resource === 'swarmPrompts' ? 'swarm_prompts' : resource
    this.assertWritable(table, scope, id, access)
    const ownerId = access?.ownerId ?? null
    if (resource === 'messages' || resource === 'llmDebugTraces' || resource === 'storySaves') {
      const storyId = text(value.storyId)
      const ownAccess = access ? { ownerId: access.ownerId } : undefined
      if (!this.get('stories', scope, storyId, ownAccess)) {
        throw Object.assign(new Error('La historia no pertenece al usuario'), {
          code: 'ERR_READ_ONLY_RESOURCE'
        })
      }
    }
    if (resource === 'stories' && access) {
      const ownAccess = { ownerId: access.ownerId }
      for (const characterId of stringArray(value.characterIds)) {
        if (!this.get('characters', scope, characterId, ownAccess)) {
          throw Object.assign(new Error('El personaje no pertenece al usuario'), {
            code: 'ERR_READ_ONLY_RESOURCE'
          })
        }
      }
      const backgroundId = typeof value.initialBackgroundId === 'string'
        ? value.initialBackgroundId
        : null
      if (backgroundId && !this.get('backgrounds', scope, backgroundId, ownAccess)) {
        throw Object.assign(new Error('El fondo no pertenece al usuario'), {
          code: 'ERR_READ_ONLY_RESOURCE'
        })
      }
    }
    switch (resource) {
      case 'characters':
        this.database
          .prepare(`
            INSERT INTO characters(
              scope, owner_id, id, name, prompt, tags_json, color, image_generation_preset,
              image_generation_lora, image_generation_seed, image_generation_prompt_prefix,
              image_generation_model, archived, visible_in_demo,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scope, id) DO UPDATE SET
              name = excluded.name,
              prompt = excluded.prompt,
              tags_json = excluded.tags_json,
              color = excluded.color,
              image_generation_preset = excluded.image_generation_preset,
              image_generation_lora = excluded.image_generation_lora,
              image_generation_seed = excluded.image_generation_seed,
              image_generation_prompt_prefix = excluded.image_generation_prompt_prefix,
              image_generation_model = excluded.image_generation_model,
              archived = excluded.archived,
              visible_in_demo = excluded.visible_in_demo,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at
          `)
          .run(
            scope,
            ownerId,
            id,
            text(value.name),
            text(value.prompt),
            json(tags(value.tags)),
            text(value.color),
            text(value.imageGenerationPreset),
            text(value.imageGenerationLora),
            text(value.imageGenerationSeed),
            text(value.imageGenerationPromptPrefix),
            text(value.imageGenerationModel),
            bool(value.archived),
            bool(value.visibleInDemo),
            integer(value.createdAt),
            integer(value.updatedAt)
          )
        break
      case 'stories':
        this.database
          .prepare(`
            INSERT INTO stories(
              scope, owner_id, id, title, premise, visual_mode, auto_generate_images, archived, visible_in_demo, protagonist_preferences,
              protagonist_preferences_mode, character_ids_json, character_customizations_json,
              initial_background_id, background_style, preset_id, image_catalog_snapshot_json,
              pending_image_instructions_json, context_summary,
              context_summary_through_message_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scope, id) DO UPDATE SET
              title = excluded.title,
              premise = excluded.premise,
              visual_mode = excluded.visual_mode,
              auto_generate_images = excluded.auto_generate_images,
              archived = excluded.archived,
              visible_in_demo = excluded.visible_in_demo,
              protagonist_preferences = excluded.protagonist_preferences,
              protagonist_preferences_mode = excluded.protagonist_preferences_mode,
              character_ids_json = excluded.character_ids_json,
              character_customizations_json = excluded.character_customizations_json,
              initial_background_id = excluded.initial_background_id,
              background_style = excluded.background_style,
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
            ownerId,
            id,
            text(value.title),
            text(value.premise),
            value.visualMode === true ? 1 : 0,
            value.autoGenerateImages === true ? 1 : 0,
            bool(value.archived),
            bool(value.visibleInDemo),
            text(value.protagonistPreferences),
            value.protagonistPreferencesMode === 'replace' ? 'replace' : 'append',
            json(stringArray(value.characterIds)),
            json(value.characterCustomizations),
            typeof value.initialBackgroundId === 'string' ? value.initialBackgroundId : null,
            text(value.backgroundStyle).trim() || null,
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
            INSERT INTO messages(scope, owner_id, id, story_id, role, raw, segments_json, swarm_error_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scope, id) DO UPDATE SET
              story_id = excluded.story_id,
              role = excluded.role,
              raw = excluded.raw,
              segments_json = excluded.segments_json,
              swarm_error_json = excluded.swarm_error_json,
              created_at = excluded.created_at
          `)
          .run(
            scope,
            ownerId,
            id,
            text(value.storyId),
            value.role === 'assistant' ? 'assistant' : 'user',
            text(value.raw),
            json(Array.isArray(value.segments) ? value.segments : []),
            readStorySwarmError(value.swarmError) ? json(readStorySwarmError(value.swarmError)) : null,
            integer(value.createdAt)
          )
        break
      case 'llmDebugTraces':
        this.database
          .prepare(`
            INSERT INTO llm_debug_traces(
              scope, owner_id, id, story_id, request_message_id, response_message_id,
              status, request_json, response_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            ownerId,
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
              scope, owner_id, id, story_id, name, story_json, messages_json,
              debug_traces_json, thumbnail_data_url, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            ownerId,
            id,
            text(value.storyId),
            text(value.name),
            json(record(value.story)),
            json(sanitizeSavedMessages(value.messages)),
            json(Array.isArray(value.debugTraces) ? value.debugTraces : []),
            text(value.thumbnailDataUrl),
            integer(value.createdAt)
          )
        break
      case 'swarmPrompts':
        if (!text(value.name).trim() || !text(value.prompt).trim()) throw new Error('Nombre y prompt obligatorios')
        this.database.prepare(`
          INSERT INTO swarm_prompts(scope, owner_id, id, name, prompt, tags_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(scope, id) DO UPDATE SET name = excluded.name, prompt = excluded.prompt,
            tags_json = excluded.tags_json, updated_at = excluded.updated_at
        `).run(scope, ownerId, id, text(value.name).trim(), text(value.prompt).trim(), json(tags(value.tags)),
          integer(value.createdAt), integer(value.updatedAt))
        break
      case 'presets':
        this.database
          .prepare(`
            INSERT INTO presets(scope, owner_id, id, name, content, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scope, id) DO UPDATE SET
              name = excluded.name,
              content = excluded.content,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at
          `)
          .run(
            scope,
            ownerId,
            id,
            text(value.name),
            text(value.content),
            integer(value.createdAt),
            integer(value.updatedAt)
          )
        break
    }
    const saved = this.get(resource, scope, id, access)
    if (!saved) throw new Error(`No se pudo recuperar ${resource}/${id} tras guardarlo`)
    return saved
  }

  putBinary(
    resource: 'images' | 'backgrounds' | 'sounds',
    scope: DataScope,
    id: string,
    payload: BinaryPayload,
    access?: StorageAccess
  ) {
    const value = payload.metadata
    this.assertWritable(resource, scope, id, access)
    const ownerId = access?.ownerId ?? null
    if (resource === 'images') {
      return this.transaction(() => {
        const characterId = text(value.characterId)
        const ownAccess = access ? { ownerId: access.ownerId } : undefined
        if (!this.get('characters', scope, characterId, ownAccess)) {
          throw Object.assign(new Error('El personaje no pertenece al usuario'), {
            code: 'ERR_READ_ONLY_RESOURCE'
          })
        }
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
            .prepare('INSERT INTO image_blobs(scope, owner_id, id, data) VALUES (?, ?, ?, ?)')
            .run(scope, ownerId, blobId, payload.data)
        }
        if (isDefault) {
          this.database
            .prepare('UPDATE images SET is_default = 0 WHERE scope = ? AND owner_id IS ? AND character_id = ? AND id <> ?')
            .run(scope, ownerId, characterId, id)
        }
        this.database
          .prepare(`
            INSERT INTO images(
              scope, owner_id, id, character_id, tags_json, is_default,
              mime_type, created_at, blob_id, original_data, original_mime_type, generation_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            ownerId,
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
        return this.get('images', scope, id, access)
      })
    }

    if (resource === 'backgrounds') return this.transaction(() => {
      const preparedTags = tags(value.tags)
      const ownAccess = access ? { ownerId: access.ownerId } : undefined
      const usedTags = new Set(
        (this.list('backgrounds', scope, {}, ownAccess) as Array<{ id: string; tags: string[] }>)
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
          INSERT INTO backgrounds(scope, owner_id, id, tags_json, style, description, mime_type, visible_in_demo, created_at, data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(scope, id) DO UPDATE SET
            tags_json = excluded.tags_json,
            style = excluded.style,
            description = excluded.description,
            mime_type = excluded.mime_type,
            visible_in_demo = excluded.visible_in_demo,
            created_at = excluded.created_at,
            data = excluded.data
        `)
        .run(
          scope,
          ownerId,
          id,
          json(preparedTags),
          text(value.style).trim(),
          text(value.description),
          text(value.mimeType, 'application/octet-stream'),
          bool(value.visibleInDemo),
          integer(value.createdAt),
          payload.data
        )
      return this.get('backgrounds', scope, id, access)
    })

    return this.transaction(() => {
      const preparedTags = tags(value.tags)
      const ownAccess = access ? { ownerId: access.ownerId } : undefined
      const usedTags = new Set(
        (this.list('sounds', scope, {}, ownAccess) as Array<{ id: string; tags: string[] }>)
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
      if (characterId && !this.get('characters', scope, characterId, ownAccess)) {
        throw Object.assign(new Error('El personaje no pertenece al usuario'), {
          code: 'ERR_READ_ONLY_RESOURCE'
        })
      }
      if (backgroundId && !this.get('backgrounds', scope, backgroundId, ownAccess)) {
        throw Object.assign(new Error('El fondo no pertenece al usuario'), {
          code: 'ERR_READ_ONLY_RESOURCE'
        })
      }
      this.database
        .prepare(`
          INSERT INTO sounds(
            scope, owner_id, id, tags_json, character_id, background_id, mime_type, created_at, data
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          ownerId,
          id,
          json(preparedTags),
          characterId,
          backgroundId,
          text(value.mimeType, 'application/octet-stream'),
          integer(value.createdAt),
          payload.data
        )
      return this.get('sounds', scope, id, access)
    })
  }

  delete(resource: DataResource, scope: DataScope, id: string, access?: StorageAccess) {
    if (resource === 'messages') {
      this.deleteMessages(scope, [id], access)
      return
    }
    const table = resource === 'llmDebugTraces'
      ? 'llm_debug_traces'
      : resource === 'storySaves'
        ? 'story_saves'
        : resource === 'swarmPrompts' ? 'swarm_prompts' : resource
    this.assertWritable(table, scope, id, access)
    if (resource === 'characters') {
      const stories = (this.database.prepare(
        access
          ? 'SELECT id, title, character_ids_json, character_customizations_json FROM stories WHERE scope = ? AND owner_id IS ?'
          : 'SELECT id, title, character_ids_json, character_customizations_json FROM stories WHERE scope = ?'
      ).all(...(access ? [scope, access.ownerId] : [scope])) as Array<{
        id: string
        title: string
        character_ids_json: string
        character_customizations_json: string
      }>)
        .filter((story) =>
          parseJson<string[]>(story.character_ids_json, []).includes(id) ||
          parseJson<Story['characterCustomizations']>(
            story.character_customizations_json,
            []
          ).some((customization) => customization.characterId === id)
        )
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
    if (access) {
      this.database.prepare(
        `DELETE FROM ${table} WHERE scope = ? AND id = ? AND owner_id IS ?`
      ).run(scope, id, access.ownerId)
    } else {
      this.database.prepare(`DELETE FROM ${table} WHERE scope = ? AND id = ?`).run(scope, id)
    }
  }

  createStorySave(
    scope: DataScope,
    storyId: string,
    name: string,
    thumbnailDataUrl: string,
    access?: StorageAccess
  ) {
    return this.transaction(() => {
      const ownAccess = access ? { ownerId: access.ownerId } : undefined
      const story = this.get('stories', scope, storyId, ownAccess) as Story | null
      if (!story) return null
      const save: StorySaveSlot = {
        id: randomUUID(),
        storyId,
        name,
        story,
        messages: this.list('messages', scope, { storyId }, ownAccess) as Message[],
        debugTraces: this.list('llmDebugTraces', scope, { storyId }, ownAccess) as LlmDebugTrace[],
        thumbnailDataUrl,
        createdAt: Date.now()
      }
      return this.put('storySaves', scope, save.id, save, ownAccess)
    })
  }

  loadStorySave(scope: DataScope, id: string, access?: StorageAccess) {
    return this.transaction(() => {
      const ownAccess = access ? { ownerId: access.ownerId } : undefined
      const save = this.get('storySaves', scope, id, ownAccess) as StorySaveSlot | null
      if (!save) return null
      const current = this.get('stories', scope, save.storyId, ownAccess) as Story | null
      if (!current) return null
      const story = {
        ...save.story,
        id: save.storyId,
        createdAt: current.createdAt,
        updatedAt: Date.now()
      }
      this.put('stories', scope, save.storyId, story, ownAccess)
      this.database.prepare(
        'DELETE FROM llm_debug_traces WHERE scope = ? AND story_id = ? AND owner_id IS ?'
      ).run(scope, save.storyId, access?.ownerId ?? null)
      this.database.prepare(
        'DELETE FROM messages WHERE scope = ? AND story_id = ? AND owner_id IS ?'
      ).run(scope, save.storyId, access?.ownerId ?? null)
      for (const message of save.messages) {
        this.put('messages', scope, text(message.id), { ...message, storyId: save.storyId }, ownAccess)
      }
      for (const trace of save.debugTraces) {
        this.put('llmDebugTraces', scope, text(trace.id), { ...trace, storyId: save.storyId }, ownAccess)
      }
      return { save, story }
    })
  }

  deleteMessages(scope: DataScope, ids: string[], access?: StorageAccess) {
    if (ids.length === 0) return
    this.transaction(() => {
      const deleteMessage = this.database.prepare(
        access
          ? 'DELETE FROM messages WHERE scope = ? AND id = ? AND owner_id IS ?'
          : 'DELETE FROM messages WHERE scope = ? AND id = ?'
      )
      for (const id of ids) {
        deleteMessage.run(...(access ? [scope, id, access.ownerId] : [scope, id]))
      }

      const traces = this.database
        .prepare(`
          SELECT id, status, request_message_id, response_message_id, request_json
          FROM llm_debug_traces WHERE scope = ?${access ? ' AND owner_id IS ?' : ''}
        `)
        .all(...(access ? [scope, access.ownerId] : [scope])) as Array<{
        id: string
        status: 'success' | 'error'
        request_message_id: string | null
        response_message_id: string | null
        request_json: string
      }>
      const idSet = new Set(ids)
      const deleteTrace = this.database.prepare(
        `DELETE FROM llm_debug_traces WHERE scope = ? AND id = ?${access ? ' AND owner_id IS ?' : ''}`
      )
      for (const trace of traces) {
        if (
          (trace.response_message_id && idSet.has(trace.response_message_id)) ||
          ((trace.status === 'error' ||
            parseJson<{ purpose?: string }>(trace.request_json, {}).purpose === 'compaction') &&
            trace.request_message_id &&
            idSet.has(trace.request_message_id))
        ) {
          deleteTrace.run(...(access ? [scope, trace.id, access.ownerId] : [scope, trace.id]))
        }
      }
    })
  }

  clear(scope: DataScope, access?: StorageAccess) {
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
        if (access) {
          this.database.prepare(`DELETE FROM ${table} WHERE scope = ? AND owner_id IS ?`)
            .run(scope, access.ownerId)
        } else {
          this.database.prepare(`DELETE FROM ${table} WHERE scope = ?`).run(scope)
        }
      }
    })
  }

  readSettings(ownerId?: string): SettingsRow | null {
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
    const value = parseJson<Record<string, unknown>>(row.value_json, {})
    return {
      value: ownerId ? { ...value, ...this.readUserSettings(ownerId) } : value,
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
      ) {
        if (
          (key === 'narrativePrompt' || key === 'characterReferencePrompt') &&
          value === null
        ) {
          Reflect.deleteProperty(nextValue, key)
        } else nextValue[key] = value
      }
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
