import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { stripBracketedText } from './storyDisplayText.ts'

describe('texto visible de la historia', () => {
  it('oculta anotaciones entre corchetes sin juntar palabras', () => {
    assert.equal(
      stripBracketedText('Antes [gesto secreto] durante [tono bajo] después.'),
      'Antes durante después.'
    )
  })

  it('oculta bloques anidados y el bloque incompleto durante streaming', () => {
    assert.equal(stripBracketedText('Texto [exterior [interior] oculto] final.'), 'Texto final.')
    assert.equal(stripBracketedText('Texto visible [todavía pintándose'), 'Texto visible')
  })

  it('conserva corchetes de cierre sin apertura y saltos de línea visibles', () => {
    assert.equal(stripBracketedText('Primera ] línea.\n[oculto]\nÚltima línea.'), 'Primera ] línea.\n\nÚltima línea.')
  })
})
