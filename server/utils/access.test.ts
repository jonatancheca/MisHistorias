import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT
} from 'jose'
import {
  canRecoverAdministrator,
  parseAccessConfiguration,
  verifyAccessIdentity
} from './access.ts'

const configuration = {
  teamDomain: 'https://equipo.cloudflareaccess.com',
  audience: 'audience_tag_1234567890'
}

async function signer() {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const publicJwk = await exportJWK(publicKey)
  publicJwk.kid = 'test-key'
  const key = createLocalJWKSet({ keys: [publicJwk] })
  const sign = (payload: Record<string, unknown>) => new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .sign(privateKey)
  return { key, sign }
}

test('valida firma, emisor y audience del JWT de Cloudflare Access', async () => {
  const { key, sign } = await signer()
  const token = await sign({
    type: 'app',
    sub: 'access-user-id',
    email: 'user@example.com',
    iss: configuration.teamDomain,
    aud: configuration.audience,
    exp: 2_000
  })
  assert.deepEqual(
    await verifyAccessIdentity(token, configuration, { key, now: new Date(1_000_000) }),
    { id: 'access-user-id', email: 'user@example.com' }
  )
})

test('rechaza tokens Access falsos, expirados o con emisor, audience o tipo incorrectos', async () => {
  const { key, sign } = await signer()
  const base = {
    type: 'app', sub: 'user', email: 'user@example.com',
    iss: configuration.teamDomain, aud: configuration.audience, exp: 2_000
  }
  assert.equal(await verifyAccessIdentity('invalid', configuration, { key }), null)
  assert.equal(await verifyAccessIdentity(await sign({ ...base, type: 'org' }), configuration, {
    key, now: new Date(1_000_000)
  }), null)
  assert.equal(await verifyAccessIdentity(await sign({ ...base, exp: 1_000 }), configuration, {
    key, now: new Date(1_000_000)
  }), null)
  assert.equal(await verifyAccessIdentity(await sign({ ...base, nbf: 1_001 }), configuration, {
    key, now: new Date(1_000_000)
  }), null)
  assert.equal(await verifyAccessIdentity(await sign({ ...base, aud: 'other-audience-tag' }), configuration, {
    key, now: new Date(1_000_000)
  }), null)
  assert.equal(await verifyAccessIdentity(await sign({ ...base, iss: 'https://otro.cloudflareaccess.com' }), configuration, {
    key, now: new Date(1_000_000)
  }), null)
})

test('normaliza solo configuraciones válidas de Cloudflare Access', () => {
  assert.deepEqual(parseAccessConfiguration({
    teamDomain: 'https://equipo.cloudflareaccess.com/',
    audience: 'audience_tag_1234567890'
  }), configuration)
  assert.throws(() => parseAccessConfiguration({
    teamDomain: 'http://equipo.cloudflareaccess.com',
    audience: configuration.audience
  }))
  assert.throws(() => parseAccessConfiguration({
    teamDomain: configuration.teamDomain,
    audience: 'corto'
  }))
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
