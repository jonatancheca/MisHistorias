import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeAccessIdentity } from './access.ts'

function token(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encoded}.signature`
}

test('lee sub y email del JWT de Cloudflare Access sin conservar el token', () => {
  assert.deepEqual(
    decodeAccessIdentity(token({
      type: 'app',
      sub: 'access-user-id',
      email: 'user@example.com',
      exp: 2_000
    }), 1_000),
    { id: 'access-user-id', email: 'user@example.com' }
  )
})

test('rechaza tokens Access inválidos, expirados o todavía no válidos', () => {
  assert.equal(decodeAccessIdentity('invalid', 1_000), null)
  assert.equal(decodeAccessIdentity(token({
    type: 'org', sub: 'user', email: 'user@example.com', exp: 2_000
  }), 1_000), null)
  assert.equal(decodeAccessIdentity(token({
    type: 'app', sub: 'user', email: 'user@example.com', exp: 1_000
  }), 1_000), null)
  assert.equal(decodeAccessIdentity(token({
    type: 'app', sub: 'user', email: 'user@example.com', nbf: 1_001
  }), 1_000), null)
  assert.equal(decodeAccessIdentity(token({
    type: 'app', sub: '', email: 'user@example.com', exp: 2_000
  }), 1_000), null)
})
