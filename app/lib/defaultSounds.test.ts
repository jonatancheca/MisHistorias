import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { generateDefaultSounds } from '../../scripts/generate-default-sounds.mjs'
import {
  DEFAULT_SOUNDS,
  DEFAULT_SOUND_VERSION,
  planDefaultSoundSeeds
} from './defaultSounds.ts'

describe('sonidos predeterminados', () => {
  it('define diez conceptos con etiquetas principales únicas', () => {
    assert.equal(DEFAULT_SOUNDS.length, 10)
    assert.equal(new Set(DEFAULT_SOUNDS.map((sound) => sound.tags[0])).size, 10)
  })

  it('respeta sonidos del usuario y no repone borrados de una versión aplicada', () => {
    const seeds = planDefaultSoundSeeds([
      { id: 'user-steps', tags: ['pasos'] },
      { id: 'user-walking', tags: ['caminar'] }
    ], 0)
    assert.equal(seeds.some((sound) => sound.id === 'default-sound-steps'), false)
    assert.equal(seeds.length, 9)
    assert.deepEqual(planDefaultSoundSeeds([], DEFAULT_SOUND_VERSION), [])
  })

  it('genera WAV PCM válidos, audibles y deterministas', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mishistorias-sounds-'))
    try {
      const generated = await generateDefaultSounds(directory)
      assert.equal(generated.length, DEFAULT_SOUNDS.length)
      for (const definition of DEFAULT_SOUNDS) {
        const committed = await readFile(resolve('public', 'sounds', 'default', definition.file))
        const regenerated = await readFile(resolve(directory, definition.file))
        assert.deepEqual(regenerated, committed)
        assert.equal(committed.toString('ascii', 0, 4), 'RIFF')
        assert.equal(committed.toString('ascii', 8, 12), 'WAVE')
        assert.equal(committed.readUInt16LE(20), 1)
        assert.equal(committed.readUInt16LE(22), 1)
        assert.equal(committed.readUInt32LE(24), 22_050)
        assert.equal(committed.readUInt16LE(34), 16)
        assert.ok(committed.subarray(44).some((byte) => byte !== 0))
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
