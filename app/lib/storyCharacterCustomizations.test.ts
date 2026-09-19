import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  activeStoryCharacterCustomizations,
  storyCustomizationIds
} from './storyCharacterCustomizations.ts'

const active = {
  characterId: 'active',
  name: 'Activa',
  color: '#123456',
  prompt: 'Prompt activo',
  tags: ['activa']
}
const remembered = {
  characterId: 'remembered',
  name: 'Recordada',
  color: '#654321',
  prompt: 'Prompt privado recordado',
  tags: ['recordada']
}

test('ordena elenco activo antes de personalizaciones recordadas sin duplicados', () => {
  assert.deepEqual(
    storyCustomizationIds(['active'], [remembered, active]),
    ['active', 'remembered']
  )
})

test('exportación demo excluye personalizaciones fuera del elenco activo', () => {
  assert.deepEqual(
    activeStoryCharacterCustomizations(['active'], [active, remembered]),
    [active]
  )
})
