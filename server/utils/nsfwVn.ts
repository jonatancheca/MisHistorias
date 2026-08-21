import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { getStorage } from './storage.ts'
import { getStorySession } from './nsfwStorage.ts'

function db() {
  return getStorage().database
}

export interface VnSave {
  id: string
  sessionId: string
  ownerUserId: string
  label: string
  headBeatId: string | null
  isAutosave: boolean
  payload: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export function listVnSaves(sessionId: string, ownerUserId: string) {
  const session = getStorySession(sessionId, ownerUserId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })
  const rows = db()
    .prepare(`
      SELECT * FROM nsfw_vn_saves
      WHERE session_id = ? AND owner_user_id = ?
      ORDER BY updated_at DESC
    `)
    .all(sessionId, ownerUserId) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    id: String(row.id),
    sessionId: String(row.session_id),
    ownerUserId: String(row.owner_user_id),
    label: String(row.label),
    headBeatId: (row.head_beat_id as string | null) ?? null,
    isAutosave: Boolean(row.is_autosave),
    payload: JSON.parse(String(row.payload_json || '{}')) as Record<string, unknown>,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }))
}

export function upsertVnSave(params: {
  sessionId: string
  ownerUserId: string
  label: string
  headBeatId: string | null
  isAutosave?: boolean
  payload?: Record<string, unknown>
  saveId?: string
}) {
  const session = getStorySession(params.sessionId, params.ownerUserId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })
  if (session.format !== 'vn') {
    throw createError({ statusCode: 400, statusMessage: 'Solo VN admite saves' })
  }

  const now = Date.now()
  if (params.isAutosave) {
    const existing = db()
      .prepare(`
        SELECT id FROM nsfw_vn_saves
        WHERE session_id = ? AND owner_user_id = ? AND is_autosave = 1
        LIMIT 1
      `)
      .get(params.sessionId, params.ownerUserId) as { id: string } | undefined
    if (existing) {
      db()
        .prepare(`
          UPDATE nsfw_vn_saves
          SET label = ?, head_beat_id = ?, payload_json = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          params.label || 'Autosave',
          params.headBeatId,
          JSON.stringify(params.payload ?? {}),
          now,
          existing.id
        )
      return listVnSaves(params.sessionId, params.ownerUserId).find((save) => save.id === existing.id)!
    }
  }

  const id = params.saveId || randomUUID()
  db()
    .prepare(`
      INSERT INTO nsfw_vn_saves(
        id, session_id, owner_user_id, label, head_beat_id, is_autosave, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      params.sessionId,
      params.ownerUserId,
      params.label || (params.isAutosave ? 'Autosave' : 'Guardado'),
      params.headBeatId,
      params.isAutosave ? 1 : 0,
      JSON.stringify(params.payload ?? {}),
      now,
      now
    )
  return listVnSaves(params.sessionId, params.ownerUserId).find((save) => save.id === id)!
}

export function markUnitsRead(sessionId: string, ownerUserId: string, beatId: string, unitIndexes: number[]) {
  const session = getStorySession(sessionId, ownerUserId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })
  const now = Date.now()
  const statement = db().prepare(`
    INSERT INTO nsfw_read_units(session_id, beat_id, unit_index, read_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id, beat_id, unit_index) DO UPDATE SET read_at = excluded.read_at
  `)
  for (const index of unitIndexes) {
    statement.run(sessionId, beatId, index, now)
  }
  return listReadUnits(sessionId)
}

export function listReadUnits(sessionId: string) {
  return db()
    .prepare('SELECT beat_id, unit_index FROM nsfw_read_units WHERE session_id = ?')
    .all(sessionId) as Array<{ beat_id: string; unit_index: number }>
}
