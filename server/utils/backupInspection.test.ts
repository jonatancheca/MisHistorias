import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { inspectBackupsInBackground } from './backupInspection.ts'
import { MisHistoriasStorage } from './storage.ts'

test('lista backups fuera del hilo principal con la misma validación y agrupa peticiones simultáneas', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-backup-worker-'))
  const storage = new MisHistoriasStorage(join(directory, 'test.sqlite'))
  try {
    storage.createManualBackup()
    const backups = join(directory, 'backups')
    writeFileSync(join(backups, 'test.uploaded-corrupt.sqlite'), 'not sqlite')
    new DatabaseSync(join(backups, 'test.manual-empty.sqlite')).close()
    const future = new DatabaseSync(join(backups, 'test.manual-future.sqlite'))
    future.exec('CREATE TABLE characters (id TEXT); PRAGMA user_version = 999')
    future.close()
    writeFileSync(join(backups, 'other.manual-ignored.sqlite'), 'not sqlite')
    writeFileSync(join(backups, 'test.ignored.txt'), 'not sqlite')
    mkdirSync(join(backups, 'test.directory.sqlite'))

    const expected = storage.listBackups()
    let settled = false
    const pending = storage.listBackupsInBackground()
    assert.equal(storage.listBackupsInBackground(), pending)
    void pending.then(() => { settled = true }, () => { settled = true })
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(settled, false, 'El hilo principal debe continuar mientras se inspeccionan las copias')
    assert.deepEqual(await pending, expected)
    assert.equal(expected.length, 4)
    assert.equal(expected.filter(backup => backup.valid).length, 1)

    // A subsequent request must see external changes, not cached validity.
    const valid = expected.find(backup => backup.valid)!
    writeFileSync(join(backups, valid.name), 'corrupted after listing')
    assert.equal((await storage.listBackupsInBackground()).find(backup => backup.name === valid.name)?.valid, false)
  } finally {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('el listado en segundo plano admite directorio ausente y permite reintentar tras fallo', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-backup-worker-'))
  const backups = join(directory, 'backups')
  try {
    assert.deepEqual(await inspectBackupsInBackground(backups, 'test', 43), [])
    writeFileSync(backups, 'not a directory')
    await assert.rejects(inspectBackupsInBackground(backups, 'test', 43))
    rmSync(backups)
    mkdirSync(backups)
    assert.deepEqual(await inspectBackupsInBackground(backups, 'test', 43), [])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
