import assert from 'node:assert/strict'
import test from 'node:test'
import { canRecoverAdministrator, decodeAccessIdentity } from './access.ts'

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

test('recupera administrador solo con nuevo sub y mismo email Access', () => {
  const state = {
    multiUserEnabled: true,
    adminOwnerId: 'old-admin-sub',
    adminEmail: 'admin@example.com'
  }
  const identity = { id: 'new-admin-sub', email: 'Admin@example.com' }
  const request = {
    source: { id: 'old-admin-sub', email: 'admin@example.com' },
    destination: { id: 'new-admin-sub', email: 'admin@example.com' }
  }
  assert.equal(canRecoverAdministrator(state, identity, request), true)
  assert.equal(canRecoverAdministrator(state, identity, {
    ...request,
    source: { ...request.source, id: 'other-sub' }
  }), false)
  assert.equal(canRecoverAdministrator(state, identity, {
    ...request,
    destination: { ...request.destination, id: 'attacker-sub' }
  }), false)
  assert.equal(canRecoverAdministrator(state, { ...identity, email: 'other@example.com' }, request), false)
})
