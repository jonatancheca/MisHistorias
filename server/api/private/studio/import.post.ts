import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import {
  addToLibrary,
  createCharacter,
  createExperience,
  createPlace,
  getPublication,
  listCharacters,
  listExperiences,
  listPlaces
} from '../../../utils/nsfwStudio.ts'
import type {
  NsfwStudioCharacter,
  NsfwStudioExperience,
  NsfwStudioPlace
} from '../../../../shared/types/nsfw/studio.ts'

/**
 * Copia a tu Studio un personaje, lugar o Experience publicado en el Hub.
 * Sin esto solo se pueden usar los recursos propios al crear una historia.
 * Es idempotente por nombre: repetir la importación devuelve la copia existente.
 */
export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const body = (await readBody(event)) as Record<string, unknown>
  const publicationId = typeof body.publicationId === 'string' ? body.publicationId : ''
  if (!publicationId) throw createError({ statusCode: 400, statusMessage: 'Falta publicationId' })

  const publication = getPublication(publicationId)
  if (!publication || publication.status !== 'published') {
    throw createError({ statusCode: 404, statusMessage: 'Publicación no disponible' })
  }

  const snapshot = publication.snapshotJson as {
    character?: NsfwStudioCharacter
    place?: NsfwStudioPlace
    experience?: NsfwStudioExperience
  }

  addToLibrary(user.id, publicationId)

  if (publication.resourceType === 'character') {
    const source = snapshot.character
    const name = source?.name || publication.title
    const existing = listCharacters(user.id).find((item) => item.name === name)
    if (existing) return { resourceType: 'character', character: existing, created: false }
    const character = createCharacter(user.id, {
      name,
      tags: source?.tags?.length ? [...source.tags] : [...publication.tags],
      color: source?.color,
      defaults: source?.defaults
    })
    return { resourceType: 'character', character, created: true }
  }

  if (publication.resourceType === 'place') {
    const source = snapshot.place
    const name = source?.name || publication.title
    const existing = listPlaces(user.id).find((item) => item.name === name)
    if (existing) return { resourceType: 'place', place: existing, created: false }
    const place = createPlace(user.id, {
      name,
      setting: source?.setting,
      era: source?.era,
      tags: source?.tags ? [...source.tags] : []
    })
    return { resourceType: 'place', place, created: true }
  }

  if (publication.resourceType === 'experience') {
    const source = snapshot.experience
    const title = source?.title || publication.title
    const existing = listExperiences(user.id).find((item) => item.title === title)
    if (existing) return { resourceType: 'experience', experience: existing, created: false }
    const experience = createExperience(user.id, {
      title,
      premise: source?.premise || publication.summary,
      slots: source?.slots ? [...source.slots] : [],
      adultProfile: source?.adultProfile,
      planSeeds: source?.planSeeds ? [...source.planSeeds] : [],
      endings: source?.endings ? [...source.endings] : []
    })
    return { resourceType: 'experience', experience, created: true }
  }

  throw createError({ statusCode: 400, statusMessage: 'Tipo no importable' })
})
