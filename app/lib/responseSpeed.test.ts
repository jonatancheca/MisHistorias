import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { responseCharactersPerSecond } from './responseSpeed.ts'

describe('velocidad de respuesta', () => {
  it('ralentiza los modos lento y medio solo en novela visual', () => {
    assert.equal(responseCharactersPerSecond('slow', true), 8)
    assert.equal(responseCharactersPerSecond('slow', false), 20)
    assert.equal(responseCharactersPerSecond('medium', true), 20)
    assert.equal(responseCharactersPerSecond('medium', false), 50)
  })

  it('mantiene la velocidad alta', () => {
    assert.equal(responseCharactersPerSecond('high', true), 100)
  })
})
