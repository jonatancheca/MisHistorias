import assert from 'node:assert/strict'
import test from 'node:test'
import { readSwarmDiagnostic, sanitizeSwarmDiagnostic } from './swarmError.ts'

test('elimina credenciales anidadas y cabeceras reflejadas sin alterar el diagnóstico útil', () => {
  const sanitized = sanitizeSwarmDiagnostic({
    request: { model: 'cyberrealisticPony_v180Coreshift.safetensors', session_id: 'session-secret', headers: { cookie: 'cookie-secret' } },
    response: { error: 'Backend failed', authorization: 'Bearer authorization-secret', nested: { access_token: 'access-secret' } },
    text: 'Authorization: Bearer text-secret\nCookie: swarm_token=cookie-secret; other=other-secret\nURL http://user:password-secret@swarm.test/'
  })
  const serialized = JSON.stringify(sanitized)
  for (const secret of ['session-secret', 'cookie-secret', 'other-secret', 'authorization-secret', 'access-secret', 'text-secret', 'password-secret']) {
    assert.equal(serialized.includes(secret), false)
  }
  assert.equal(serialized.includes('Backend failed'), true)
  assert.equal(serialized.includes('cyberrealisticPony_v180Coreshift.safetensors'), true)
  assert.equal(readSwarmDiagnostic({ target: 'swarm', request: 'invalid' }), undefined)
})
