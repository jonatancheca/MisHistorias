import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_PRIMARY_INTERESTS, sortInterestTerms } from './nsfwCreatorConfig.ts'

const term = (label: string, isPrivate = false) => ({
  id: label,
  label,
  facet: 'interés',
  private: isPrivate
})

describe('catálogo de intereses', () => {
  it('sube lo clasificado, luego lo privado y después lo público', () => {
    const ordered = sortInterestTerms(
      [term('Zeta'), term('Alfa'), term('Mía', true), term('Beta'), term('Otra', true)],
      { primary: ['Zeta'], excluded: [], contextual: ['beta'] }
    )
    assert.deepEqual(
      ordered.map((item) => item.label),
      ['Beta', 'Zeta', 'Mía', 'Otra', 'Alfa']
    )
  })

  it('mantiene el tope de predominantes en tres', () => {
    assert.equal(MAX_PRIMARY_INTERESTS, 3)
  })
})
