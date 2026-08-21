import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  currentRevealLine,
  currentRevealLineEnd,
  isHiddenVisualRevealLine
} from './progressiveReveal.ts'

describe('revelado progresivo por líneas', () => {
  it('completa solo la línea visible', () => {
    const graphemes = Array.from('Primera línea.\nSegunda línea.')
    assert.equal(currentRevealLineEnd(graphemes, 4), 15)
    assert.equal(currentRevealLineEnd(graphemes, 15), graphemes.length)
  })

  it('cuenta grafemas recibidos sin depender de índices UTF-16', () => {
    const graphemes = ['🙂', 'H', 'o', 'l', 'a', '\n', 'F', 'i', 'n']
    assert.equal(currentRevealLineEnd(graphemes, 1), 6)
    assert.equal(currentRevealLineEnd(graphemes, 6), 9)
  })

  it('identifica la línea que se está pintando', () => {
    const graphemes = ['🙂', 'H', 'o', 'l', 'a', '\n', 'F', 'i', 'n']
    assert.deepEqual(currentRevealLine(graphemes, 2), {
      start: 0,
      end: 6,
      text: '🙂Hola'
    })
    assert.deepEqual(currentRevealLine(graphemes, 6), {
      start: 6,
      end: 9,
      text: 'Fin'
    })
  })

  it('distingue directivas invisibles de frases visuales', () => {
    assert.equal(isHiddenVisualRevealLine('Fondo [bosque]:'), true)
    assert.equal(isHiddenVisualRevealLine('  Sonido [lluvia]:  '), true)
    assert.equal(isHiddenVisualRevealLine('   '), true)
    assert.equal(isHiddenVisualRevealLine('Alicia [feliz]: Hola'), false)
    assert.equal(isHiddenVisualRevealLine('La puerta se abre.'), false)
  })
})
