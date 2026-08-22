import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { relativeTime } from './relativeTime.ts'

describe('tiempo relativo', () => {
  const now = Date.UTC(2026, 7, 21, 12, 0, 0)
  const hour = 60 * 60 * 1000

  it('elige la unidad mayor que encaja', () => {
    assert.equal(relativeTime(now - 2 * hour, now), 'hace 2 h')
    assert.equal(relativeTime(now - 24 * hour, now), 'ayer')
    assert.equal(relativeTime(now - 14 * 24 * hour, now), 'hace 2 sem.')
  })

  it('colapsa lo reciente en «ahora»', () => {
    assert.equal(relativeTime(now - 5000, now), 'ahora')
  })
})
