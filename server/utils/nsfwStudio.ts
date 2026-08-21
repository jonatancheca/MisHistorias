import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import type {
  ExperienceSlot,
  HubResourceType,
  NsfwLibraryEntry,
  NsfwPublication,
  NsfwStudioCharacter,
  NsfwStudioExperience,
  NsfwStudioPlace,
  NsfwStudioSprite
} from '../../shared/types/nsfw/studio.ts'
import { getStorage } from './storage.ts'
import { svgPlaceholderBackground, svgPlaceholderSprite } from './nsfwPlaceholders.ts'

function db() {
  return getStorage().database
}

function json(value: unknown) {
  return JSON.stringify(value ?? null)
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function usernameOf(userId: string) {
  const row = db()
    .prepare('SELECT username FROM nsfw_users WHERE id = ?')
    .get(userId) as { username: string } | undefined
  return row?.username ?? 'usuario'
}

export function listCharacters(ownerUserId: string): NsfwStudioCharacter[] {
  const rows = db()
    .prepare(`
      SELECT * FROM nsfw_studio_characters
      WHERE owner_user_id = ?
      ORDER BY updated_at DESC
    `)
    .all(ownerUserId) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    name: text(row.name),
    tags: parseJson(row.tags_json, [] as string[]),
    color: text(row.color, '#ff755f'),
    defaults: parseJson(row.defaults_json, {} as Record<string, string>),
    published: Boolean(row.published),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }))
}

export function createCharacter(
  ownerUserId: string,
  input: { name: string; tags?: string[]; color?: string; defaults?: Record<string, string> }
) {
  const now = Date.now()
  const id = randomUUID()
  const name = input.name.trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Falta el nombre' })
  db()
    .prepare(`
      INSERT INTO nsfw_studio_characters(
        id, owner_user_id, name, tags_json, color, defaults_json, published, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `)
    .run(
      id,
      ownerUserId,
      name,
      json(input.tags ?? []),
      input.color?.trim() || '#ff755f',
      json(input.defaults ?? {}),
      now,
      now
    )
  return listCharacters(ownerUserId).find((item) => item.id === id)!
}

function decodeImagePayload(input: {
  dataBase64?: string
  mimeType?: string
}): { mimeType: string; data: Buffer } | null {
  if (!input.dataBase64 || typeof input.dataBase64 !== 'string') return null
  const raw = input.dataBase64.trim()
  const dataUrl = /^data:([^;]+);base64,(.+)$/s.exec(raw)
  const mimeType = (dataUrl?.[1] || input.mimeType || 'image/png').toLowerCase()
  const base64 = dataUrl?.[2] || raw
  if (!['image/png', 'image/webp', 'image/jpeg', 'image/svg+xml'].includes(mimeType)) {
    throw createError({ statusCode: 400, statusMessage: 'Formato de imagen no soportado' })
  }
  const data = Buffer.from(base64, 'base64')
  if (!data.length || data.length > 8_000_000) {
    throw createError({ statusCode: 400, statusMessage: 'Imagen vacía o demasiado grande' })
  }
  return { mimeType, data }
}

export function addSprite(
  ownerUserId: string,
  input: {
    characterId: string
    label: string
    facets: string[]
    mimeType?: string
    dataBase64?: string
  }
) {
  const character = listCharacters(ownerUserId).find((item) => item.id === input.characterId)
  if (!character) throw createError({ statusCode: 404, statusMessage: 'Personaje no encontrado' })
  const id = randomUUID()
  const now = Date.now()
  const uploaded = decodeImagePayload(input)
  const mimeType = uploaded?.mimeType || input.mimeType || 'image/svg+xml'
  const blob =
    uploaded?.data || svgPlaceholderSprite(input.label.trim() || character.name, character.color)
  db()
    .prepare(`
      INSERT INTO nsfw_studio_sprites(
        id, character_id, owner_user_id, label, facets_json, mime_type, data, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      input.characterId,
      ownerUserId,
      input.label.trim() || 'Sprite',
      json(input.facets),
      mimeType,
      blob,
      now
    )
  return getSprites(input.characterId, ownerUserId).find((item) => item.id === id)!
}

export function getSprites(characterId: string, ownerUserId: string): NsfwStudioSprite[] {
  const rows = db()
    .prepare(`
      SELECT * FROM nsfw_studio_sprites
      WHERE character_id = ? AND owner_user_id = ?
      ORDER BY created_at DESC
    `)
    .all(characterId, ownerUserId) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    id: String(row.id),
    characterId: String(row.character_id),
    ownerUserId: String(row.owner_user_id),
    label: text(row.label),
    facets: parseJson(row.facets_json, [] as string[]),
    mimeType: text(row.mime_type, 'image/png'),
    createdAt: Number(row.created_at)
  }))
}

export function listPlaces(ownerUserId: string): NsfwStudioPlace[] {
  const rows = db()
    .prepare(`
      SELECT * FROM nsfw_studio_places
      WHERE owner_user_id = ?
      ORDER BY updated_at DESC
    `)
    .all(ownerUserId) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    name: text(row.name),
    setting: text(row.setting),
    era: text(row.era),
    tags: parseJson(row.tags_json, [] as string[]),
    published: Boolean(row.published),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }))
}

export function createPlace(
  ownerUserId: string,
  input: { name: string; setting?: string; era?: string; tags?: string[] }
) {
  const now = Date.now()
  const id = randomUUID()
  const name = input.name.trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Falta el nombre' })
  db()
    .prepare(`
      INSERT INTO nsfw_studio_places(
        id, owner_user_id, name, setting, era, tags_json, published, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `)
    .run(
      id,
      ownerUserId,
      name,
      input.setting?.trim() || 'Interior',
      input.era?.trim() || 'Contemporánea',
      json(input.tags ?? []),
      now,
      now
    )
  db()
    .prepare(`
      INSERT INTO nsfw_studio_place_backgrounds(
        id, place_id, owner_user_id, version, active, mime_type, data, created_at
      ) VALUES (?, ?, ?, 1, 1, 'image/svg+xml', ?, ?)
    `)
    .run(randomUUID(), id, ownerUserId, svgPlaceholderBackground(name), now)
  return listPlaces(ownerUserId).find((item) => item.id === id)!
}

export function listExperiences(ownerUserId: string): NsfwStudioExperience[] {
  const rows = db()
    .prepare(`
      SELECT * FROM nsfw_studio_experiences
      WHERE owner_user_id = ?
      ORDER BY updated_at DESC
    `)
    .all(ownerUserId) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    title: text(row.title),
    premise: text(row.premise),
    slots: parseJson(row.slots_json, [] as ExperienceSlot[]),
    adultProfile: text(row.adult_profile),
    planSeeds: parseJson(row.plan_seeds_json, [] as string[]),
    endings: parseJson(row.endings_json, [] as string[]),
    published: Boolean(row.published),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }))
}

export function createExperience(
  ownerUserId: string,
  input: {
    title: string
    premise: string
    slots?: ExperienceSlot[]
    adultProfile?: string
    planSeeds?: string[]
    endings?: string[]
  }
) {
  const now = Date.now()
  const id = randomUUID()
  const title = input.title.trim()
  const premise = input.premise.trim()
  if (!title || !premise) {
    throw createError({ statusCode: 400, statusMessage: 'Título y premisa obligatorios' })
  }
  db()
    .prepare(`
      INSERT INTO nsfw_studio_experiences(
        id, owner_user_id, title, premise, slots_json, adult_profile,
        plan_seeds_json, endings_json, published, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `)
    .run(
      id,
      ownerUserId,
      title,
      premise,
      json(input.slots ?? []),
      input.adultProfile?.trim() || 'sensual',
      json(input.planSeeds ?? []),
      json(input.endings ?? []),
      now,
      now
    )
  return listExperiences(ownerUserId).find((item) => item.id === id)!
}

function snapshotFor(resourceType: HubResourceType, resourceId: string, ownerUserId: string) {
  if (resourceType === 'character') {
    const character = listCharacters(ownerUserId).find((item) => item.id === resourceId)
    if (!character) throw createError({ statusCode: 404, statusMessage: 'Recurso no encontrado' })
    return {
      character,
      sprites: getSprites(resourceId, ownerUserId)
    }
  }
  if (resourceType === 'place') {
    const place = listPlaces(ownerUserId).find((item) => item.id === resourceId)
    if (!place) throw createError({ statusCode: 404, statusMessage: 'Recurso no encontrado' })
    return { place }
  }
  if (resourceType === 'experience') {
    const experience = listExperiences(ownerUserId).find((item) => item.id === resourceId)
    if (!experience) throw createError({ statusCode: 404, statusMessage: 'Recurso no encontrado' })
    return { experience }
  }
  throw createError({ statusCode: 400, statusMessage: 'Tipo de recurso no publicable aún' })
}

export function publishResource(
  ownerUserId: string,
  input: {
    resourceType: HubResourceType
    resourceId: string
    title?: string
    summary?: string
    tags?: string[]
  }
) {
  const snapshot = snapshotFor(input.resourceType, input.resourceId, ownerUserId)
  const now = Date.now()
  const id = randomUUID()
  let title = input.title?.trim() || ''
  let summary = input.summary?.trim() || ''
  if (input.resourceType === 'character') {
    const character = (snapshot as { character: NsfwStudioCharacter }).character
    title ||= character.name
    summary ||= `Personaje ${character.name}`
    db()
      .prepare('UPDATE nsfw_studio_characters SET published = 1, updated_at = ? WHERE id = ?')
      .run(now, input.resourceId)
  } else if (input.resourceType === 'place') {
    const place = (snapshot as { place: NsfwStudioPlace }).place
    title ||= place.name
    summary ||= `${place.setting} · ${place.era}`
    db()
      .prepare('UPDATE nsfw_studio_places SET published = 1, updated_at = ? WHERE id = ?')
      .run(now, input.resourceId)
  } else if (input.resourceType === 'experience') {
    const experience = (snapshot as { experience: NsfwStudioExperience }).experience
    title ||= experience.title
    summary ||= experience.premise.slice(0, 180)
    db()
      .prepare('UPDATE nsfw_studio_experiences SET published = 1, updated_at = ? WHERE id = ?')
      .run(now, input.resourceId)
  }

  db()
    .prepare(`
      INSERT INTO nsfw_publications(
        id, owner_user_id, resource_type, resource_id, title, summary, tags_json,
        status, snapshot_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)
    `)
    .run(
      id,
      ownerUserId,
      input.resourceType,
      input.resourceId,
      title,
      summary,
      json(input.tags ?? []),
      json(snapshot),
      now,
      now
    )

  return getPublication(id)!
}

export function withdrawPublication(publicationId: string, ownerUserId?: string) {
  const publication = getPublication(publicationId)
  if (!publication) {
    throw createError({ statusCode: 404, statusMessage: 'Publicación no encontrada' })
  }
  if (ownerUserId && publication.ownerUserId !== ownerUserId) {
    throw createError({ statusCode: 404, statusMessage: 'Publicación no encontrada' })
  }
  db()
    .prepare(`
      UPDATE nsfw_publications
      SET status = 'withdrawn', updated_at = ?
      WHERE id = ?
    `)
    .run(Date.now(), publicationId)
  return getPublication(publicationId)!
}

export function adminWithdrawPublication(publicationId: string) {
  return withdrawPublication(publicationId)
}

export function getPublication(id: string): NsfwPublication | null {
  const row = db()
    .prepare('SELECT * FROM nsfw_publications WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    ownerUsername: usernameOf(String(row.owner_user_id)),
    resourceType: row.resource_type as HubResourceType,
    resourceId: String(row.resource_id),
    title: text(row.title),
    summary: text(row.summary),
    tags: parseJson(row.tags_json, [] as string[]),
    status: row.status as 'published' | 'withdrawn',
    snapshotJson: parseJson(row.snapshot_json, {}),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }
}

export function listHub(query: { type?: string; q?: string } = {}): NsfwPublication[] {
  const rows = db()
    .prepare(`
      SELECT * FROM nsfw_publications
      WHERE status = 'published'
      ORDER BY updated_at DESC
    `)
    .all() as Array<Record<string, unknown>>
  let items = rows.map((row) => getPublication(String(row.id))!).filter(Boolean)
  if (query.type) items = items.filter((item) => item.resourceType === query.type)
  if (query.q?.trim()) {
    const needle = query.q.trim().toLocaleLowerCase()
    items = items.filter(
      (item) =>
        item.title.toLocaleLowerCase().includes(needle) ||
        item.summary.toLocaleLowerCase().includes(needle) ||
        item.tags.some((tag) => tag.toLocaleLowerCase().includes(needle))
    )
  }
  return items
}

export function addToLibrary(ownerUserId: string, publicationId: string): NsfwLibraryEntry {
  const publication = getPublication(publicationId)
  if (!publication || publication.status !== 'published') {
    throw createError({ statusCode: 409, statusMessage: 'Publicación no disponible para Add' })
  }
  const existing = db()
    .prepare(`
      SELECT id FROM nsfw_library_entries
      WHERE owner_user_id = ? AND publication_id = ?
    `)
    .get(ownerUserId, publicationId) as { id: string } | undefined
  if (existing) {
    return listLibrary(ownerUserId).find((item) => item.id === existing.id)!
  }
  const id = randomUUID()
  db()
    .prepare(`
      INSERT INTO nsfw_library_entries(
        id, owner_user_id, publication_id, resource_type, title, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(id, ownerUserId, publicationId, publication.resourceType, publication.title, Date.now())
  return listLibrary(ownerUserId).find((item) => item.id === id)!
}

export function listLibrary(ownerUserId: string): NsfwLibraryEntry[] {
  const rows = db()
    .prepare(`
      SELECT * FROM nsfw_library_entries
      WHERE owner_user_id = ?
      ORDER BY created_at DESC
    `)
    .all(ownerUserId) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    publicationId: String(row.publication_id),
    resourceType: row.resource_type as HubResourceType,
    title: text(row.title),
    createdAt: Number(row.created_at)
  }))
}

export function listTaxonomy(status: 'approved' | 'proposed' | 'discarded' = 'approved') {
  return db()
    .prepare(`
      SELECT id, label, kind, status, proposed_by, created_at
      FROM nsfw_taxonomy_terms
      WHERE status = ?
      ORDER BY label COLLATE NOCASE ASC
    `)
    .all(status) as Array<Record<string, unknown>>
}

export function proposeTaxonomyTerm(
  userId: string,
  input: { label: string; kind?: string }
) {
  const label = input.label.trim()
  if (!label) throw createError({ statusCode: 400, statusMessage: 'Falta la etiqueta' })
  const id = randomUUID()
  try {
    db()
      .prepare(`
        INSERT INTO nsfw_taxonomy_terms(id, label, kind, status, proposed_by, created_at)
        VALUES (?, ?, ?, 'proposed', ?, ?)
      `)
      .run(id, label, input.kind || 'interest', userId, Date.now())
  } catch (caught) {
    if (caught instanceof Error && caught.message.includes('UNIQUE')) {
      throw createError({ statusCode: 409, statusMessage: 'Término ya existente' })
    }
    throw caught
  }
  return { id, label, status: 'proposed' }
}

export function followCreator(followerUserId: string, followedUserId: string) {
  if (followerUserId === followedUserId) {
    throw createError({ statusCode: 400, statusMessage: 'No puedes seguirte a ti' })
  }
  const exists = db()
    .prepare('SELECT id FROM nsfw_users WHERE id = ? AND active = 1')
    .get(followedUserId)
  if (!exists) throw createError({ statusCode: 404, statusMessage: 'Usuario no encontrado' })
  db()
    .prepare(`
      INSERT INTO nsfw_follows(follower_user_id, followed_user_id, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(follower_user_id, followed_user_id) DO NOTHING
    `)
    .run(followerUserId, followedUserId, Date.now())
  return { ok: true }
}

export function unfollowCreator(followerUserId: string, followedUserId: string) {
  db()
    .prepare(`
      DELETE FROM nsfw_follows
      WHERE follower_user_id = ? AND followed_user_id = ?
    `)
    .run(followerUserId, followedUserId)
  return { ok: true }
}

export function listFollows(followerUserId: string) {
  return db()
    .prepare(`
      SELECT f.followed_user_id AS userId, u.username, f.created_at AS createdAt
      FROM nsfw_follows f
      JOIN nsfw_users u ON u.id = f.followed_user_id
      WHERE f.follower_user_id = ?
      ORDER BY f.created_at DESC
    `)
    .all(followerUserId) as Array<{ userId: string; username: string; createdAt: number }>
}

export function ratePublication(
  userId: string,
  publicationId: string,
  score: number,
  dimensions: Record<string, number> = {}
) {
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw createError({ statusCode: 400, statusMessage: 'Score 1–5' })
  }
  const publication = getPublication(publicationId)
  if (!publication || publication.status !== 'published') {
    throw createError({ statusCode: 404, statusMessage: 'Publicación no disponible' })
  }
  const existing = db()
    .prepare('SELECT id FROM nsfw_ratings WHERE publication_id = ? AND user_id = ?')
    .get(publicationId, userId) as { id: string } | undefined
  const now = Date.now()
  if (existing) {
    db()
      .prepare(`
        UPDATE nsfw_ratings
        SET score = ?, dimensions_json = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(score, json(dimensions), now, existing.id)
    return { id: existing.id, score }
  }
  const id = randomUUID()
  db()
    .prepare(`
      INSERT INTO nsfw_ratings(id, publication_id, user_id, score, dimensions_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(id, publicationId, userId, score, json(dimensions), now)
  return { id, score }
}

export function getPublicationRatingSummary(publicationId: string) {
  const row = db()
    .prepare(`
      SELECT AVG(score) AS average, COUNT(*) AS count
      FROM nsfw_ratings
      WHERE publication_id = ?
    `)
    .get(publicationId) as { average: number | null; count: number }
  return {
    average: row.average === null ? null : Number(row.average),
    count: Number(row.count || 0)
  }
}

export function addComment(userId: string, publicationId: string, body: string) {
  const textBody = body.trim()
  if (!textBody) throw createError({ statusCode: 400, statusMessage: 'Comentario vacío' })
  const publication = getPublication(publicationId)
  if (!publication || publication.status !== 'published') {
    throw createError({ statusCode: 404, statusMessage: 'Publicación no disponible' })
  }
  const id = randomUUID()
  db()
    .prepare(`
      INSERT INTO nsfw_comments(id, publication_id, user_id, body, hidden, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `)
    .run(id, publicationId, userId, textBody, Date.now())
  return { id, body: textBody }
}

export function listComments(publicationId: string) {
  return db()
    .prepare(`
      SELECT c.id, c.body, c.created_at AS createdAt, u.username
      FROM nsfw_comments c
      JOIN nsfw_users u ON u.id = c.user_id
      WHERE c.publication_id = ? AND c.hidden = 0
      ORDER BY c.created_at DESC
    `)
    .all(publicationId) as Array<{ id: string; body: string; createdAt: number; username: string }>
}

export function createCollection(
  ownerUserId: string,
  input: { title: string; summary?: string; kind?: 'user' | 'editorial' }
) {
  const title = input.title.trim()
  if (!title) throw createError({ statusCode: 400, statusMessage: 'Falta el título' })
  const id = randomUUID()
  const now = Date.now()
  db()
    .prepare(`
      INSERT INTO nsfw_collections(id, owner_user_id, title, kind, summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(id, ownerUserId, title, input.kind || 'user', input.summary?.trim() || '', now, now)
  return listCollections(ownerUserId).find((item) => item.id === id)!
}

export function listCollections(ownerUserId?: string) {
  const rows = (
    ownerUserId
      ? db()
          .prepare(`
            SELECT * FROM nsfw_collections
            WHERE owner_user_id = ? OR kind = 'editorial'
            ORDER BY updated_at DESC
          `)
          .all(ownerUserId)
      : db()
          .prepare(`
            SELECT * FROM nsfw_collections
            ORDER BY updated_at DESC
          `)
          .all()
  ) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    title: text(row.title),
    kind: row.kind as 'user' | 'editorial',
    summary: text(row.summary),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }))
}

export function addToCollection(ownerUserId: string, collectionId: string, publicationId: string) {
  const collection = listCollections(ownerUserId).find((item) => item.id === collectionId)
  if (!collection || collection.ownerUserId !== ownerUserId) {
    throw createError({ statusCode: 404, statusMessage: 'Colección no encontrada' })
  }
  const publication = getPublication(publicationId)
  if (!publication || publication.status !== 'published') {
    throw createError({ statusCode: 409, statusMessage: 'Publicación no disponible' })
  }
  db()
    .prepare(`
      INSERT INTO nsfw_collection_entries(collection_id, publication_id, position, created_at)
      VALUES (?, ?, 0, ?)
      ON CONFLICT(collection_id, publication_id) DO NOTHING
    `)
    .run(collectionId, publicationId, Date.now())
  return { ok: true }
}

export function createSceneCg(
  ownerUserId: string,
  input: { title: string; tags?: string[] }
) {
  const id = randomUUID()
  db()
    .prepare(`
      INSERT INTO nsfw_scene_cgs(id, owner_user_id, title, tags_json, version, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `)
    .run(id, ownerUserId, input.title.trim() || 'CG', json(input.tags ?? []), Date.now())
  return { id, title: input.title.trim() || 'CG' }
}

export function markCgSeen(sessionId: string, cgId: string) {
  db()
    .prepare(`
      INSERT INTO nsfw_seen_cgs(session_id, cg_id, seen_at)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id, cg_id) DO UPDATE SET seen_at = excluded.seen_at
    `)
    .run(sessionId, cgId, Date.now())
}

export function listSeenCgs(sessionId: string) {
  return db()
    .prepare(`
      SELECT c.id, c.title, c.tags_json, s.seen_at
      FROM nsfw_seen_cgs s
      JOIN nsfw_scene_cgs c ON c.id = s.cg_id
      WHERE s.session_id = ?
      ORDER BY s.seen_at DESC
    `)
    .all(sessionId) as Array<Record<string, unknown>>
}

export function sharePublicationPath(publicationId: string) {
  const publication = getPublication(publicationId)
  if (!publication || publication.status !== 'published') {
    throw createError({ statusCode: 404, statusMessage: 'No compartible' })
  }
  return { path: `/private/hub?publication=${publicationId}` }
}

export function getSpriteMedia(spriteId: string, ownerUserId: string) {
  const row = db()
    .prepare(`
      SELECT id, mime_type, data, owner_user_id
      FROM nsfw_studio_sprites
      WHERE id = ?
    `)
    .get(spriteId) as
    | { id: string; mime_type: string; data: Buffer | null; owner_user_id: string }
    | undefined
  if (!row || row.owner_user_id !== ownerUserId || !row.data) return null
  return { mimeType: row.mime_type, data: row.data }
}

export function getPlaceBackgroundMedia(backgroundId: string, ownerUserId: string) {
  const row = db()
    .prepare(`
      SELECT id, mime_type, data, owner_user_id
      FROM nsfw_studio_place_backgrounds
      WHERE id = ?
    `)
    .get(backgroundId) as
    | { id: string; mime_type: string; data: Buffer | null; owner_user_id: string }
    | undefined
  if (!row || row.owner_user_id !== ownerUserId || !row.data) return null
  return { mimeType: row.mime_type, data: row.data }
}

export function getActiveBackgroundForPlace(placeId: string, ownerUserId: string) {
  return db()
    .prepare(`
      SELECT id FROM nsfw_studio_place_backgrounds
      WHERE place_id = ? AND owner_user_id = ? AND active = 1
      ORDER BY version DESC
      LIMIT 1
    `)
    .get(placeId, ownerUserId) as { id: string } | undefined
}

export function setPlaceBackground(
  ownerUserId: string,
  placeId: string,
  input: { dataBase64: string; mimeType?: string }
) {
  const place = listPlaces(ownerUserId).find((item) => item.id === placeId)
  if (!place) throw createError({ statusCode: 404, statusMessage: 'Lugar no encontrado' })
  const uploaded = decodeImagePayload(input)
  if (!uploaded) throw createError({ statusCode: 400, statusMessage: 'Falta la imagen' })
  const now = Date.now()
  const id = randomUUID()
  const previous = db()
    .prepare(`
      SELECT COALESCE(MAX(version), 0) AS version
      FROM nsfw_studio_place_backgrounds
      WHERE place_id = ? AND owner_user_id = ?
    `)
    .get(placeId, ownerUserId) as { version: number }
  db()
    .prepare(`
      UPDATE nsfw_studio_place_backgrounds
      SET active = 0
      WHERE place_id = ? AND owner_user_id = ?
    `)
    .run(placeId, ownerUserId)
  db()
    .prepare(`
      INSERT INTO nsfw_studio_place_backgrounds(
        id, place_id, owner_user_id, version, active, mime_type, data, created_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)
    `)
    .run(id, placeId, ownerUserId, Number(previous.version) + 1, uploaded.mimeType, uploaded.data, now)
  return getActiveBackgroundForPlace(placeId, ownerUserId)!
}

export function buildDefaultAssetPins(ownerUserId: string) {
  const place = listPlaces(ownerUserId)[0]
  const character = listCharacters(ownerUserId)[0]
  const sprite = character ? getSprites(character.id, ownerUserId)[0] : null
  const background = place ? getActiveBackgroundForPlace(place.id, ownerUserId) : null
  return {
    placeId: place?.id ?? null,
    placeBackgroundId: background?.id ?? null,
    characterSprites: sprite && character ? { companion: sprite.id } : {}
  }
}

export function getCreatorPublicProfile(userId: string) {
  const user = db()
    .prepare('SELECT id, username, role, active, created_at FROM nsfw_users WHERE id = ?')
    .get(userId) as
    | { id: string; username: string; role: string; active: number; created_at: number }
    | undefined
  if (!user || !user.active) return null
  const publications = listHub().filter((item) => item.ownerUserId === userId)
  return {
    userId: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.created_at,
    publications,
    counts: {
      characters: publications.filter((item) => item.resourceType === 'character').length,
      places: publications.filter((item) => item.resourceType === 'place').length,
      experiences: publications.filter((item) => item.resourceType === 'experience').length,
      stories: publications.filter((item) => item.resourceType === 'story').length
    }
  }
}

export function cloneCharacterFromCast(
  ownerUserId: string,
  input: {
    name: string
    personality?: string
    characterization?: string
    tags?: string[]
    sourceCharacterId?: string | null
  }
) {
  const character = createCharacter(ownerUserId, {
    name: input.name.trim() || 'Clone',
    tags: [
      ...(input.tags ?? []),
      'clone',
      ...(input.sourceCharacterId ? [`from:${input.sourceCharacterId}`] : [])
    ],
    defaults: {
      personality: input.personality || '',
      characterization: input.characterization || ''
    }
  })
  addSprite(ownerUserId, {
    characterId: character.id,
    label: 'Base',
    facets: ['neutral', 'standing', 'clothed']
  })
  return character
}
