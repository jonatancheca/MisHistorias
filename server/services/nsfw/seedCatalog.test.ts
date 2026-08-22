import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NSFW_SEED_CHARACTERS,
  NSFW_SEED_EXPERIENCES,
  NSFW_SEED_PLACES
} from './seedCatalog.ts'

test('catálogo semilla cumple 12/12/8 con nombres distintos', () => {
  assert.equal(NSFW_SEED_CHARACTERS.length, 12)
  assert.equal(NSFW_SEED_PLACES.length, 12)
  assert.equal(NSFW_SEED_EXPERIENCES.length, 8)

  const characterNames = NSFW_SEED_CHARACTERS.map((item) => item.name)
  const placeNames = NSFW_SEED_PLACES.map((item) => item.name)
  const experienceTitles = NSFW_SEED_EXPERIENCES.map((item) => item.title)

  assert.equal(new Set(characterNames).size, 12)
  assert.equal(new Set(placeNames).size, 12)
  assert.equal(new Set(experienceTitles).size, 8)

  for (const character of NSFW_SEED_CHARACTERS) {
    assert.ok(character.tags.length >= 1)
  }
  for (const place of NSFW_SEED_PLACES) {
    assert.ok(place.setting)
    assert.ok(place.era)
  }
  for (const experience of NSFW_SEED_EXPERIENCES) {
    assert.ok(experience.premise.length > 20)
  }
})
