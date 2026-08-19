import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { currentRevealLineEnd } from './progressiveReveal.ts'

describe('revelado progresivo por líneas', () => {
  it('completa solo la línea visible', () => {
    const graphemes = Array.from('Primera línea.\nSegunda línea.')
    assert.equal(currentRevealLineEnd(graphemes, 4), 14)
    assert.equal(currentRevealLineEnd(graphemes, 15), graphemes.length)
  })

  it('cuenta grafemas recibidos sin depender de índices UTF-16', () => {
    const graphemes = ['🙂', 'H', 'o', 'l', 'a', '\n', 'F', 'i', 'n']
    assert.equal(currentRevealLineEnd(graphemes, 1), 5)
    assert.equal(currentRevealLineEnd(graphemes, 6), 9)
  })
})
