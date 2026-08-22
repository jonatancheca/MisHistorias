import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import {
  addSprite,
  createCharacter,
  createExperience,
  createPlace,
  listCharacters,
  listExperiences,
  listPlaces
} from '../../../utils/nsfwStudio.ts'
import {
  NSFW_SEED_CHARACTERS,
  NSFW_SEED_EXPERIENCES,
  NSFW_SEED_PLACES
} from '../../../services/nsfw/seedCatalog.ts'

export default defineEventHandler((event) => {
  const user = requireSessionUser(event)
  const existing = {
    characters: listCharacters(user.id).length,
    places: listPlaces(user.id).length,
    experiences: listExperiences(user.id).length
  }

  let createdCharacters = 0
  let createdPlaces = 0
  let createdExperiences = 0

  if (existing.characters < NSFW_SEED_CHARACTERS.length) {
    for (const item of NSFW_SEED_CHARACTERS) {
      if (listCharacters(user.id).some((character) => character.name === item.name)) continue
      const character = createCharacter(user.id, { name: item.name, tags: [...item.tags] })
      addSprite(user.id, {
        characterId: character.id,
        label: 'Base',
        facets: ['neutral', 'standing', 'clothed', ...item.tags]
      })
      createdCharacters += 1
    }
  }

  if (existing.places < NSFW_SEED_PLACES.length) {
    for (const item of NSFW_SEED_PLACES) {
      if (listPlaces(user.id).some((place) => place.name === item.name)) continue
      createPlace(user.id, {
        name: item.name,
        setting: item.setting,
        era: item.era
      })
      createdPlaces += 1
    }
  }

  if (existing.experiences < NSFW_SEED_EXPERIENCES.length) {
    for (const item of NSFW_SEED_EXPERIENCES) {
      if (listExperiences(user.id).some((experience) => experience.title === item.title)) continue
      createExperience(user.id, { title: item.title, premise: item.premise })
      createdExperiences += 1
    }
  }

  return {
    created: {
      characters: createdCharacters,
      places: createdPlaces,
      experiences: createdExperiences
    },
    totals: {
      characters: listCharacters(user.id).length,
      places: listPlaces(user.id).length,
      experiences: listExperiences(user.id).length
    },
    targets: {
      characters: NSFW_SEED_CHARACTERS.length,
      places: NSFW_SEED_PLACES.length,
      experiences: NSFW_SEED_EXPERIENCES.length
    }
  }
})
