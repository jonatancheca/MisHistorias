import { randomUUID } from 'node:crypto'
import { getStorage } from './storage.ts'
import { getAttempt, updateAttempt } from './nsfwStorage.ts'
import { listTaxonomy } from './nsfwStudio.ts'
import { MAX_PRIMARY_INTERESTS } from '../../shared/lib/nsfwCreatorConfig.ts'

function db() {
  return getStorage().database
}

export type FeedbackKind = 'bug' | 'suggestion' | 'checkpoint' | 'survey' | 'thumb'

export function createProductFeedback(input: {
  userId: string
  kind: FeedbackKind
  body?: string
  score?: number | null
  sessionId?: string | null
  attemptId?: string | null
  metadata?: Record<string, unknown>
}) {
  const id = randomUUID()
  db()
    .prepare(`
      INSERT INTO nsfw_product_feedback(
        id, user_id, kind, session_id, attempt_id, score, body, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      input.userId,
      input.kind,
      input.sessionId ?? null,
      input.attemptId ?? null,
      input.score ?? null,
      input.body?.trim() || '',
      JSON.stringify(input.metadata ?? {}),
      Date.now()
    )
  return getFeedback(id)!
}

export function getFeedback(id: string) {
  const row = db()
    .prepare('SELECT * FROM nsfw_product_feedback WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: String(row.id),
    userId: String(row.user_id),
    kind: row.kind as FeedbackKind,
    sessionId: row.session_id ? String(row.session_id) : null,
    attemptId: row.attempt_id ? String(row.attempt_id) : null,
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    body: typeof row.body === 'string' ? row.body : '',
    metadata: (() => {
      try {
        return JSON.parse(String(row.metadata_json || '{}')) as Record<string, unknown>
      } catch {
        return {}
      }
    })(),
    createdAt: Number(row.created_at)
  }
}

export function listProductFeedback(limit = 100) {
  const rows = db()
    .prepare(`
      SELECT * FROM nsfw_product_feedback
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(limit) as Array<Record<string, unknown>>
  return rows.map((row) => getFeedback(String(row.id))!).filter(Boolean)
}

export function setAttemptThumb(
  attemptId: string,
  ownerUserId: string,
  thumb: 'up' | 'down'
) {
  const attempt = getAttempt(attemptId, ownerUserId)
  if (!attempt) throw createError({ statusCode: 404, statusMessage: 'Intento no encontrado' })
  updateAttempt(attemptId, { thumb })
  createProductFeedback({
    userId: ownerUserId,
    kind: 'thumb',
    attemptId,
    sessionId: attempt.sessionId,
    score: thumb === 'up' ? 5 : 1,
    body: thumb,
    metadata: { thumb }
  })
  return getAttempt(attemptId, ownerUserId)!
}

export function getUsageSummary(ownerUserId: string) {
  const rows = db()
    .prepare(`
      SELECT a.id, a.session_id, a.model_alias, a.model_id, a.generation_profile,
             a.state, a.usage_json, a.latency_ms, a.created_at, a.pipeline_passes_json,
             a.thumb, s.title
      FROM nsfw_generation_attempts a
      JOIN nsfw_story_sessions s ON s.id = a.session_id
      WHERE s.owner_user_id = ?
      ORDER BY a.created_at DESC
      LIMIT 200
    `)
    .all(ownerUserId) as Array<Record<string, unknown>>

  return rows.map((row) => {
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    try {
      usage = JSON.parse(String(row.usage_json || '{}'))
    } catch {
      /* ignore */
    }
    return {
      attemptId: String(row.id),
      sessionId: String(row.session_id),
      title: String(row.title),
      modelAlias: String(row.model_alias),
      modelId: String(row.model_id),
      generationProfile: String(row.generation_profile),
      state: String(row.state),
      latencyMs: Number(row.latency_ms || 0),
      thumb: row.thumb === 'up' || row.thumb === 'down' ? row.thumb : null,
      usage,
      createdAt: Number(row.created_at)
    }
  })
}

export function listAdminGenerations(limit = 100) {
  const rows = db()
    .prepare(`
      SELECT a.id, a.session_id, a.model_alias, a.model_id, a.generation_profile,
             a.state, a.usage_json, a.latency_ms, a.created_at, a.error_message,
             a.skill_versions_json, s.owner_user_id, s.format, u.username
      FROM nsfw_generation_attempts a
      JOIN nsfw_story_sessions s ON s.id = a.session_id
      JOIN nsfw_users u ON u.id = s.owner_user_id
      ORDER BY a.created_at DESC
      LIMIT ?
    `)
    .all(limit) as Array<Record<string, unknown>>

  return rows.map((row) => {
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    try {
      usage = JSON.parse(String(row.usage_json || '{}'))
    } catch {
      /* ignore */
    }
    return {
      attemptId: String(row.id),
      sessionId: String(row.session_id),
      ownerUserId: String(row.owner_user_id),
      username: String(row.username),
      format: String(row.format),
      modelAlias: String(row.model_alias),
      modelId: String(row.model_id),
      generationProfile: String(row.generation_profile),
      state: String(row.state),
      latencyMs: Number(row.latency_ms || 0),
      usage,
      errorMessage: row.error_message ? String(row.error_message) : null,
      skillVersions: (() => {
        try {
          return JSON.parse(String(row.skill_versions_json || '{}'))
        } catch {
          return {}
        }
      })(),
      createdAt: Number(row.created_at)
    }
  })
}

export function listAdminPublications() {
  return db()
    .prepare(`
      SELECT p.*, u.username
      FROM nsfw_publications p
      JOIN nsfw_users u ON u.id = p.owner_user_id
      ORDER BY p.updated_at DESC
    `)
    .all() as Array<Record<string, unknown>>
}

export function hideComment(commentId: string, hidden: boolean) {
  db()
    .prepare('UPDATE nsfw_comments SET hidden = ? WHERE id = ?')
    .run(hidden ? 1 : 0, commentId)
}

export function listAdminComments(limit = 100) {
  return db()
    .prepare(`
      SELECT c.*, u.username
      FROM nsfw_comments c
      JOIN nsfw_users u ON u.id = c.user_id
      ORDER BY c.created_at DESC
      LIMIT ?
    `)
    .all(limit) as Array<Record<string, unknown>>
}

export function setTaxonomyStatus(termId: string, status: 'approved' | 'discarded' | 'proposed') {
  db()
    .prepare('UPDATE nsfw_taxonomy_terms SET status = ? WHERE id = ?')
    .run(status, termId)
  return db()
    .prepare('SELECT * FROM nsfw_taxonomy_terms WHERE id = ?')
    .get(termId)
}

export function listAllTaxonomy() {
  return {
    approved: listTaxonomy('approved'),
    proposed: listTaxonomy('proposed'),
    discarded: listTaxonomy('discarded')
  }
}

export type AdultDefaults = {
  primary: string[]
  excluded: string[]
  contextual: string[]
}

function parseAdultDefaults(raw: unknown): AdultDefaults {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!value || typeof value !== 'object') return { primary: [], excluded: [], contextual: [] }
    const record = value as Record<string, unknown>
    const list = (key: string) =>
      Array.isArray(record[key])
        ? record[key].filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
    return {
      primary: list('primary').slice(0, MAX_PRIMARY_INTERESTS),
      excluded: list('excluded'),
      contextual: list('contextual')
    }
  } catch {
    return { primary: [], excluded: [], contextual: [] }
  }
}

export function upsertSelfInsertProfile(
  userId: string,
  input: {
    displayName: string
    pronouns: string
    appearance: string
    boundaries?: string[]
    adultDefaults?: AdultDefaults
  }
) {
  const now = Date.now()
  const adultDefaults = input.adultDefaults
    ? {
        primary: input.adultDefaults.primary.map((item) => item.trim()).filter(Boolean).slice(0, MAX_PRIMARY_INTERESTS),
        excluded: input.adultDefaults.excluded.map((item) => item.trim()).filter(Boolean),
        contextual: input.adultDefaults.contextual.map((item) => item.trim()).filter(Boolean)
      }
    : getSelfInsertProfile(userId)?.adultDefaults || { primary: [], excluded: [], contextual: [] }

  db()
    .prepare(`
      INSERT INTO nsfw_self_insert_profiles(
        user_id, display_name, pronouns, appearance, boundaries_json, adult_defaults_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        display_name = excluded.display_name,
        pronouns = excluded.pronouns,
        appearance = excluded.appearance,
        boundaries_json = excluded.boundaries_json,
        adult_defaults_json = excluded.adult_defaults_json,
        updated_at = excluded.updated_at
    `)
    .run(
      userId,
      input.displayName.trim() || 'Yo',
      input.pronouns.trim() || 'elle/elle',
      input.appearance.trim(),
      JSON.stringify(input.boundaries ?? []),
      JSON.stringify(adultDefaults),
      now
    )
  return getSelfInsertProfile(userId)
}

export function getSelfInsertProfile(userId: string) {
  const row = db()
    .prepare('SELECT * FROM nsfw_self_insert_profiles WHERE user_id = ?')
    .get(userId) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    userId: String(row.user_id),
    displayName: String(row.display_name),
    pronouns: String(row.pronouns),
    appearance: String(row.appearance),
    boundaries: (() => {
      try {
        return JSON.parse(String(row.boundaries_json || '[]')) as string[]
      } catch {
        return []
      }
    })(),
    adultDefaults: parseAdultDefaults(row.adult_defaults_json),
    updatedAt: Number(row.updated_at)
  }
}

export function countUserRatings(userId: string) {
  const row = db()
    .prepare('SELECT COUNT(*) AS total FROM nsfw_ratings WHERE user_id = ?')
    .get(userId) as { total: number }
  return Number(row?.total || 0)
}

export function removeLabelFromAdultDefaults(userId: string, label: string) {
  const profile = getSelfInsertProfile(userId)
  if (!profile) return null
  const needle = label.trim().toLocaleLowerCase('es-ES')
  const filter = (values: string[]) =>
    values.filter((item) => item.trim().toLocaleLowerCase('es-ES') !== needle)
  return upsertSelfInsertProfile(userId, {
    displayName: profile.displayName,
    pronouns: profile.pronouns,
    appearance: profile.appearance,
    boundaries: profile.boundaries,
    adultDefaults: {
      primary: filter(profile.adultDefaults.primary),
      excluded: filter(profile.adultDefaults.excluded),
      contextual: filter(profile.adultDefaults.contextual)
    }
  })
}
