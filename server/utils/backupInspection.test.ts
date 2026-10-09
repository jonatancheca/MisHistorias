import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { inspectBackupsInBackground } from './backupInspection.ts'
import { MisHistoriasStorage } from './storage.ts'

test('lista backups fuera del hilo principal con comprobación ligera y agrupa peticiones simultáneas', async () => {
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
    assert.equal(expected.filter(backup => backup.compatible).length, 1)

    // A subsequent request must see external changes, not cached compatibility.
    const valid = expected.find(backup => backup.compatible)!
    writeFileSync(join(backups, valid.name), 'corrupted after listing')
    assert.equal((await storage.listBackupsInBackground()).find(backup => backup.name === valid.name)?.compatible, false)
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

test('lista compatibilidad sin leer datos corruptos y rechaza restaurarlos o importarlos', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-backup-integrity-'))
  const storage = new MisHistoriasStorage(join(directory, 'test.sqlite'))
  try {
    storage.writeSettings({ userName: 'Conservar datos actuales' })
    const before = storage.readSettings()
    const backups = join(directory, 'backups')
    mkdirSync(backups)
    const name = 'test.manual-corrupt-data.sqlite'
    const path = join(backups, name)
    const database = new DatabaseSync(path)
    database.exec('CREATE TABLE characters (id TEXT); PRAGMA user_version = 46')
    database.prepare('INSERT INTO characters (id) VALUES (?)').run('Contenido')
    const { rootpage } = database.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'characters'").get() as { rootpage: number }
    const { page_size: pageSize } = database.prepare('PRAGMA page_size').get() as { page_size: number }
    database.close()
    const bytes = readFileSync(path)
    // Damage the table page while keeping the schema readable.
    bytes[(rootpage - 1) * pageSize] = 0xff
    writeFileSync(path, bytes)

    assert.equal(storage.listBackups()[0]?.compatible, true)
    assert.equal((await storage.listBackupsInBackground())[0]?.compatible, true)
    assert.throws(() => storage.restoreBackup(name), /no es válido y no puede restaurarse/)
    assert.throws(() => storage.importBackup(path, 'corrupt.sqlite'), /no es un backup SQLite válido/)
    assert.deepEqual(storage.readSettings(), before)
    assert.deepEqual(storage.listBackups().map(backup => backup.name), [name])
  } finally {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('localiza solo el archivo solicitado y rechaza rutas, directorios y enlaces', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-backup-lookup-'))
  const storage = new MisHistoriasStorage(join(directory, 'test.sqlite'))
  try {
    const backup = storage.createManualBackup()
    const backups = join(directory, 'backups')
    const corruptName = 'test.uploaded-invalid.sqlite'
    writeFileSync(join(backups, corruptName), 'not sqlite')
    const linkName = 'test.manual-link.sqlite'
    if (process.platform === 'win32') symlinkSync(directory, join(backups, linkName), 'junction')
    else symlinkSync(join(backups, backup.name), join(backups, linkName), 'file')
    const directoryName = 'test.manual-directory.sqlite'
    mkdirSync(join(backups, directoryName))
    storage.listBackups = () => { throw new Error('No debe recorrer la carpeta para descargar') }

    assert.equal(storage.getBackupFile(backup.name).backup.compatible, true)
    assert.equal(storage.getBackupFile(corruptName).backup.compatible, false)
    for (const name of [
      '../' + backup.name, 'test.../outside.sqlite', 'test..\\outside.sqlite',
      'other.manual-file.sqlite', 'test.manual-file.sqlite.txt',
      'test.manual-file.sqlite:stream.sqlite', 'test.manual-\0file.sqlite', 'test.manual-missing.sqlite', linkName, directoryName
    ]) {
      assert.throws(() => storage.getBackupFile(name), /Backup no encontrado/, name)
    }
  } finally {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
