import type { DatabaseSync } from 'node:sqlite'
import { Worker } from 'node:worker_threads'
import type { DatabaseBackup } from '../../shared/types/index.ts'

// Keep this function self-contained: the worker runs the same validation as restores.
export function inspectBackupDatabase(path: string, maximumVersion: number, Database: typeof DatabaseSync) {
  let database: DatabaseSync | undefined
  try {
    database = new Database(path, { readOnly: true })
    const quickCheck = database.prepare('PRAGMA quick_check').all() as Array<{ quick_check: string }>
    const version = database.prepare('PRAGMA user_version').get() as { user_version: number }
    const schema = database
      .prepare("SELECT COUNT(*) AS total FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")
      .get() as { total: number }
    const applicationTables = database
      .prepare(`
        SELECT COUNT(*) AS total
        FROM sqlite_schema
        WHERE type = 'table' AND name IN (
          'characters', 'image_blobs', 'images', 'backgrounds', 'sounds', 'stories',
          'messages', 'llm_debug_traces', 'story_saves', 'presets', 'settings', 'swarm_prompts',
          'error_traces'
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
        schemaVersion <= maximumVersion,
      schemaVersion,
      applicationDatabase: applicationTables.total > 0
    }
  } catch {
    return { valid: false, schemaVersion: null, applicationDatabase: false }
  } finally {
    if (database?.isOpen) database.close()
  }
}

const pendingLists = new Map<string, Promise<DatabaseBackup[]>>()

export function inspectBackupsInBackground(directory: string, databaseName: string, maximumVersion: number) {
  const key = JSON.stringify([directory, databaseName, maximumVersion])
  const pending = pendingLists.get(key)
  if (pending) return pending

  const task = new Promise<DatabaseBackup[]>((resolve, reject) => {
    // Inline source survives Nitro bundling without a separate worker file at runtime.
    // Paths are structured worker data, never interpolated executable code.
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const { readdirSync, statSync } = require('node:fs');
      const { join } = require('node:path');
      const { DatabaseSync } = require('node:sqlite');
      const inspectDatabase = ${inspectBackupDatabase.toString()};
      const { directory, databaseName, maximumVersion } = workerData;
      let entries;
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        entries = [];
      }
      const backups = [];
      for (const entry of entries) {
        if (!entry.isFile() || entry.isSymbolicLink()
          || !entry.name.startsWith(databaseName + '.') || !entry.name.endsWith('.sqlite')) continue;
        const path = join(directory, entry.name);
        let stats;
        try {
          stats = statSync(path);
        } catch (error) {
          if (error.code === 'ENOENT') continue;
          throw error;
        }
        const validation = inspectDatabase(path, maximumVersion, DatabaseSync);
        const kind = entry.name.startsWith(databaseName + '.manual-') ? 'manual'
          : entry.name.startsWith(databaseName + '.uploaded-') ? 'uploaded'
          : entry.name.startsWith(databaseName + '.before-restore-') ? 'before-restore' : 'migration';
        backups.push({
          name: entry.name, kind, createdAt: stats.mtime.toISOString(), size: stats.size,
          schemaVersion: validation.schemaVersion,
          valid: validation.valid && validation.applicationDatabase
        });
      }
      parentPort.postMessage(backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
    `, {
      eval: true,
      execArgv: [],
      workerData: { directory, databaseName, maximumVersion }
    })
    let result: DatabaseBackup[] | undefined
    worker.once('message', (backups: DatabaseBackup[]) => { result = backups })
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (code === 0 && result) resolve(result)
      else reject(new Error('No se pudieron comprobar los backups.'))
    })
  }).finally(() => pendingLists.delete(key))
  pendingLists.set(key, task)
  return task
}
