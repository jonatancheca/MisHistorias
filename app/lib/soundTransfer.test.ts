import assert from 'node:assert/strict'
import test from 'node:test'
import { stripSoundDirectives, stripSoundSegments } from './soundTransfer.ts'

test('excluye sonidos de mensajes transferidos', () => {
  assert.equal(
    stripSoundDirectives('Fondo [bosque]:\nSonido [ramas]:\nLas ramas crujen.'),
    'Fondo [bosque]:\nLas ramas crujen.'
  )
  assert.deepEqual(
    stripSoundSegments([
      { type: 'narration', text: 'Hola' },
      { type: 'sound', tag: 'ramas' }
    ]),
    [{ type: 'narration', text: 'Hola' }]
  )
})
