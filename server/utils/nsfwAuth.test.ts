import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { getStorage } from './storage.ts'
import { createUser, ensureOwnerAdmin, hashPassword, verifyPassword } from './nsfwAuth.ts'

test('hashPassword y verifyPassword validan credenciales', () => {
  const encoded = hashPassword('contraseña-segura-1')
  assert.match(encoded, /^scrypt\$/)
  assert.equal(verifyPassword('contraseña-segura-1', encoded), true)
  assert.equal(verifyPassword('otra', encoded), false)
})

test('owner admin de email se crea y puede dar de alta a otros usuarios', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-owner-'))
  const path = join(directory, 'test.sqlite')
  process.env.NUXT_SQLITE_PATH = path
  delete process.env.PLAYWRIGHT_TEST
  const storage = getStorage(path)
  try {
    const owner = ensureOwnerAdmin()
    assert.ok(owner)
    assert.equal(owner.username.toLowerCase(), 'bernatmv@gmail.com')
    assert.equal(owner.role, 'admin')
    assert.equal(owner.active, true)

    const again = ensureOwnerAdmin()
    assert.equal(again?.id, owner.id)

    const extra = createUser({
      username: 'otro.user',
      password: 'otra-pass-12345',
      role: 'user'
    })
    assert.equal(extra.role, 'user')
    assert.equal(extra.username, 'otro.user')
  } finally {
    storage.close()
    const globalState = globalThis as typeof globalThis & {
      __misHistoriasStorage?: Map<string, unknown>
    }
    globalState.__misHistoriasStorage?.delete(path)
    rmSync(directory, { recursive: true, force: true })
    delete process.env.NUXT_SQLITE_PATH
  }
})
