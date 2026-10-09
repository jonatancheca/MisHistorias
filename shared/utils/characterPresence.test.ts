import assert from 'node:assert/strict'
import test from 'node:test'
import type { Message, Story } from '../types/index.ts'
import { preserveCharacterReturns, restoreAbsentCharacters } from './characterPresence.ts'

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


test('presencia del narrador respeta orden, elenco y retorno posterior con texto', () => {
  const story = { characterIds: ['a', 'b', 'c'], absentCharacterIds: ['b', 'c'],
    pendingImageInstructions: [{ characterId: 'a', imageId: 'a-image', tags: [] }], updatedAt: 1 } as unknown as Story
  const message: Message = { id: 'presence', storyId: 'story', role: 'assistant', raw: '', createdAt: 1, absentCharacterIds: ['b', 'c'], segments: [
    { type: 'character-present', characterId: 'b', tag: null, text: '' },
    { type: 'character-absent', characterId: 'b', tag: null, text: '' },
    { type: 'thought', characterId: 'b', tag: null, text: 'Vuelvo.' },
    { type: 'character-absent', characterId: 'a', tag: null, text: '' },
    { type: 'character-present', characterId: 'outside', tag: null, text: '', presenceApplied: true },
    { type: 'character-absent', characterId: null, tag: null, text: '', presenceApplied: true }
  ] }
  const result = restoreAbsentCharacters(message, story)
  assert.deepEqual(result.story.absentCharacterIds, ['a', 'c'])
  assert.deepEqual(result.story.pendingImageInstructions, [])
  assert.deepEqual(result.message.absentCharacterIds, ['b', 'c'])
  assert.equal(result.message.segments[2]?.returnsToScene, true)
  assert.deepEqual(result.message.segments.flatMap((segment, index) => segment.presenceApplied ? [index] : []), [0, 1, 3])
  assert.deepEqual(story.absentCharacterIds, ['b', 'c'])
})

test('editar conserva solo efectos de presencia previamente guardados', () => {
  const original: Message = { id: 'presence', storyId: 'story', role: 'assistant', raw: '', createdAt: 1, segments: [
    { type: 'character-absent', characterId: 'a', tag: null, text: '', presenceApplied: true }
  ] }
  const edited = preserveCharacterReturns({ ...original, segments: [
    ...original.segments,
    { type: 'character-present', characterId: 'b', tag: null, text: '', presenceApplied: true },
    ...original.segments
  ] }, original)
  assert.deepEqual(edited.segments.flatMap((segment, index) => segment.presenceApplied ? [index] : []), [0])
})


test('editar conserva múltiples retornos del mismo personaje después de sus salidas', () => {
  const original: Message = { id: 'returns', storyId: 'story', role: 'assistant', raw: '', createdAt: 1, absentCharacterIds: [], segments: [
    { type: 'dialogue', characterId: 'a', tag: null, text: 'Estoy aquí.' },
    { type: 'character-absent', characterId: 'a', tag: null, text: '', presenceApplied: true },
    { type: 'dialogue', characterId: 'a', tag: null, text: 'Vuelvo.', returnsToScene: true },
    { type: 'character-absent', characterId: 'a', tag: null, text: '', presenceApplied: true },
    { type: 'thought', characterId: 'a', tag: null, text: 'Otra vez aquí.', returnsToScene: true }
  ] }
  const edited = preserveCharacterReturns({ ...original, segments: original.segments.map(({ returnsToScene: _return, presenceApplied: _applied, ...segment }) => segment) }, original)
  assert.deepEqual(edited.segments.flatMap((segment, index) => segment.returnsToScene ? [index] : []), [2, 4])
  assert.deepEqual(edited.segments.flatMap((segment, index) => segment.presenceApplied ? [index] : []), [1, 3])
})
