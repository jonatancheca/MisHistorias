import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { responseCharactersPerSecond } from './responseSpeed.ts'

describe('velocidad de respuesta', () => {
  it('ralentiza el modo lento solo en novela visual', () => {
    assert.equal(responseCharactersPerSecond('slow', true), 8)
    assert.equal(responseCharactersPerSecond('slow', false), 20)
  })

  it('mantiene las demás velocidades', () => {
    assert.equal(responseCharactersPerSecond('medium', true), 50)
    assert.equal(responseCharactersPerSecond('high', true), 100)
  })
})
