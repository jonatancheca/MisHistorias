import assert from 'node:assert/strict'
import test from 'node:test'
import type { Message } from '../types/index.ts'
import { preserveCharacterReturns } from './characterPresence.ts'

test('editar conserva retorno en la primera intervención válida sin reincorporar otros ausentes', () => {
  const original: Message = { id: 'return', storyId: 'story', role: 'assistant', raw: '', createdAt: 1,
    absentCharacterIds: ['a', 'b'], segments: [
      { type: 'dialogue', characterId: 'a', tag: null, text: 'Regreso.', returnsToScene: true }
    ] }
  const updated = preserveCharacterReturns({ ...original, segments: [
    { type: 'dialogue', characterId: 'a', tag: null, text: ' ' },
    { type: 'thought', characterId: 'a', tag: null, text: 'Regreso corregido.' },
    { type: 'dialogue', characterId: 'b', tag: null, text: 'También hablo.' },
    { type: 'dialogue', characterId: 'a', tag: null, text: 'Sigo.' }
  ] }, original)
  assert.deepEqual(updated.segments.flatMap((segment, index) => segment.returnsToScene ? [index] : []), [1])
  assert.deepEqual(updated.absentCharacterIds, ['a', 'b'])
  assert.equal(original.segments[0]?.returnsToScene, true)
})
