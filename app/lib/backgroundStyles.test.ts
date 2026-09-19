import assert from 'node:assert/strict'
import test from 'node:test'
import {
  availableBackgroundStyles,
  matchesBackgroundStyle,
  normalizeBackgroundStyle
} from './backgroundStyles.ts'

test('normaliza estilos libres y agrupa sugerencias sin distinguir mayúsculas', () => {
  assert.equal(normalizeBackgroundStyle('  Dibujo   animado '), 'Dibujo animado')
  assert.deepEqual(
    availableBackgroundStyles([
      { style: 'Manga' },
      { style: ' manga ' },
      { style: '' },
      { style: 'Realista' }
    ]),
    ['Manga', 'Realista']
  )
})

test('sin estilo no filtra y un estilo seleccionado exige coincidencia exacta normalizada', () => {
  assert.equal(matchesBackgroundStyle({ style: 'Manga' }, null), true)
  assert.equal(matchesBackgroundStyle({ style: '  MANGA ' }, 'manga'), true)
  assert.equal(matchesBackgroundStyle({ style: 'Realista' }, 'manga'), false)
  assert.equal(matchesBackgroundStyle({}, 'manga'), false)
})
