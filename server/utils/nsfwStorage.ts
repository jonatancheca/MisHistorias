import { createHash, randomUUID } from 'node:crypto'
import { createError } from 'h3'
import type { GenerationEnvelope } from '../../shared/types/nsfw/envelope.ts'
import type {
  CreateStorySessionInput,
  GenerationUsage,
  NsfwGenerationAttempt,
  NsfwNarrativeBeat,
  NsfwStorySession,
  PlayerInput,
  SessionPlayState,
  StoryBible,
  StoryPlan,
  WorldState,
  SceneState,
  SessionCastMember,
  SessionAssetPins,
  AttemptState,
  GenerationProfile,
  InteractionPolicy,
  NsfwStoryFormat
} from '../../shared/types/nsfw/session.ts'
import {
  coherentConfiguration,
  MAX_PRIMARY_INTERESTS,
  mapPerspectiveToSession,
  mapToneToSession,
  type CreatorFormat,
  type NarrativePerspective,
  type NarrativeTone,
  type StoryDuration
} from '../../shared/lib/nsfwCreatorConfig.ts'
import { getStorage } from '../utils/storage.ts'

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

function integer(value: unknown, fallback = 0) {
  return Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback
}

function makeFingerprint(input: PlayerInput, revision: number, parentBeatId: string | null) {
  return createHash('sha256')
    .update(json({ input, revision, parentBeatId }))
    .digest('hex')
}

function defaultPlan(summary: string): StoryPlan {
  return {
    version: 1,
    summary: summary || 'Abrir la escena y dejar espacio al protagonista.',
    nextBeats: [
      { id: 'beat-open', intent: 'Establecer lugar, tono y primera tensión', status: 'pending' },
      { id: 'beat-agency', intent: 'Dejar al protagonista decidir el siguiente paso', status: 'pending' }
    ]
  }
}

function defaultBible(): StoryBible {
  return { version: 1, facts: [] }
}

function defaultWorld(cast: SessionCastMember[]): WorldState {
  return {
    version: 1,
    location: 'Por definir',
    presentActorIds: cast.map((member) => member.actorId),
    mood: 'expectante',
    relationshipNotes: [],
    flags: {}
  }
}

function defaultScene(cast: SessionCastMember[]): SceneState {
  return {
    location: 'Por definir',
    presentActorIds: cast.map((member) => member.actorId),
    intention: 'Abrir la historia',
    pacing: 'moderado'
  }
}

interface SessionRow {
  id: string
  owner_user_id: string
  format: string
  title: string
  premise: string
  duration: string
  tone: string
  perspective: string
  interaction_policy: string
  generation_profile: string
  model_alias: string
  head_beat_id: string | null
  revision: number
  plan_json: string
  bible_json: string
  world_state_json: string
  scene_state_json: string
  cast_json: string
  interests_json: string
  exclusions_json: string
  archived: number
  privacy_notice_seen: number
  parent_session_id: string | null
  fork_beat_id: string | null
  sequel_of_session_id: string | null
  branch_label: string | null
  finalized_at: number | null
  created_at: number
  updated_at: number
  asset_pins_json?: string
  escalation_heart?: number
  experience_id?: string | null
}

interface AttemptRow {
  id: string
  session_id: string
  parent_beat_id: string | null
  sibling_group_id: string
  input_json: string
  input_fingerprint: string
  model_alias: string
  model_id: string
  generation_profile: string
  state: string
  envelope_json: string | null
  provisional_text: string
  error_message: string | null
  usage_json: string
  retry_count: number
  created_at: number
  updated_at: number
  skill_versions_json?: string
  pipeline_passes_json?: string
  latency_ms?: number
  thumb?: string | null
}

interface BeatRow {
  id: string
  session_id: string
  parent_beat_id: string | null
  accepted_attempt_id: string
  envelope_json: string
  sequence: number
  created_at: number
}

function rowToSession(row: SessionRow): NsfwStorySession {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    format: row.format as NsfwStoryFormat,
    title: text(row.title),
    premise: text(row.premise),
    duration: text(row.duration),
    tone: text(row.tone),
    perspective: text(row.perspective),
    interactionPolicy: row.interaction_policy as InteractionPolicy,
    generationProfile: row.generation_profile as GenerationProfile,
    modelAlias: text(row.model_alias),
    headBeatId: row.head_beat_id,
    revision: integer(row.revision),
    plan: parseJson(row.plan_json, defaultPlan('')),
    bible: parseJson(row.bible_json, defaultBible()),
    worldState: parseJson(row.world_state_json, defaultWorld([])),
    sceneState: parseJson(row.scene_state_json, defaultScene([])),
    cast: parseJson(row.cast_json, [] as SessionCastMember[]),
    interests: parseJson(row.interests_json, [] as string[]),
    exclusions: parseJson(row.exclusions_json, [] as string[]),
    archived: Boolean(row.archived),
    privacyNoticeSeen: Boolean(row.privacy_notice_seen),
    parentSessionId: row.parent_session_id ?? null,
    forkBeatId: row.fork_beat_id ?? null,
    sequelOfSessionId: row.sequel_of_session_id ?? null,
    branchLabel: row.branch_label ?? null,
    finalizedAt: row.finalized_at === null || row.finalized_at === undefined ? null : integer(row.finalized_at),
    experienceId: row.experience_id ?? null,
    assetPins: parseJson(row.asset_pins_json ?? '{}', {
      placeId: null,
      placeBackgroundId: null,
      characterSprites: {}
    } as SessionAssetPins),
    escalationHeart: Boolean(row.escalation_heart),
    createdAt: integer(row.created_at),
    updatedAt: integer(row.updated_at)
  }
}

function rowToAttempt(row: AttemptRow): NsfwGenerationAttempt {
  return {
    id: row.id,
    sessionId: row.session_id,
    parentBeatId: row.parent_beat_id,
    siblingGroupId: row.sibling_group_id,
    input: parseJson(row.input_json, { kind: 'continue', text: '' } as PlayerInput),
    inputFingerprint: row.input_fingerprint,
    modelAlias: row.model_alias,
    modelId: row.model_id,
    generationProfile: row.generation_profile as GenerationProfile,
    skillVersions: parseJson(row.skill_versions_json ?? '{}', {} as Record<string, string>),
    pipelinePasses: parseJson(row.pipeline_passes_json ?? '[]', [] as NsfwGenerationAttempt['pipelinePasses']),
    latencyMs: integer(row.latency_ms ?? 0),
    thumb: row.thumb === 'up' || row.thumb === 'down' ? row.thumb : null,
    state: row.state as AttemptState,
    envelope: row.envelope_json ? parseJson(row.envelope_json, null) : null,
    provisionalText: text(row.provisional_text),
    errorMessage: row.error_message,
    usage: parseJson(row.usage_json, {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    } as GenerationUsage),
    retryCount: integer(row.retry_count),
    createdAt: integer(row.created_at),
    updatedAt: integer(row.updated_at)
  }
}

function rowToBeat(row: BeatRow): NsfwNarrativeBeat {
  return {
    id: row.id,
    sessionId: row.session_id,
    parentBeatId: row.parent_beat_id,
    acceptedAttemptId: row.accepted_attempt_id,
    envelope: parseJson(row.envelope_json, {
      schemaVersion: 1,
      language: 'es-ES',
      format: 'story',
      visibleUnits: [],
      visualCues: [],
      soundCues: [],
      choices: [],
      stateDelta: [],
      planPatch: [],
      stopReason: 'awaiting_player'
    } as GenerationEnvelope),
    sequence: integer(row.sequence),
    createdAt: integer(row.created_at)
  }
}

export function createStorySession(ownerUserId: string, input: CreateStorySessionInput) {
  const now = Date.now()
  const id = randomUUID()
  let cast = input.cast.length
    ? input.cast
    : [
        {
          actorId: 'protagonist',
          name: 'Protagonista',
          role: 'protagonist' as const,
          personality: '',
          isSelfInsert: true
        }
      ]

  // Self-insert persistente encima del protagonista sin publicar el perfil.
  const profileRow = db()
    .prepare('SELECT * FROM nsfw_self_insert_profiles WHERE user_id = ?')
    .get(ownerUserId) as Record<string, unknown> | undefined
  if (profileRow) {
    let boundaries: string[] = []
    try {
      boundaries = JSON.parse(String(profileRow.boundaries_json || '[]')) as string[]
    } catch {
      boundaries = []
    }
    const displayName = String(profileRow.display_name || '')
    const pronouns = String(profileRow.pronouns || '')
    const appearance = String(profileRow.appearance || '')
    cast = cast.map((member) => {
      if (!member.isSelfInsert && member.role !== 'protagonist') return member
      return {
        ...member,
        name: displayName || member.name,
        personality: [member.personality, appearance, pronouns].filter(Boolean).join(' · '),
        characterization:
          member.characterization ||
          `${displayName} (${pronouns}). ${appearance}. Límites: ${boundaries.join(', ') || 'ninguno'}.`,
        isSelfInsert: true
      }
    })
  }

  cast = cast.map((member) => ({
    ...member,
    characterization:
      member.characterization ||
      `Para esta historia, ${member.name} actúa con ${member.personality || 'presencia abierta'}. Preferencias de escena alineadas a la premisa; sin bio canónica del Personaje fuente.`,
    sourceCharacterId: member.sourceCharacterId ?? null,
    overrideName: member.overrideName ?? null,
    preservedRelations: member.preservedRelations ?? []
  }))
  const plan = defaultPlan(input.planSummary ?? '')
  const bible = defaultBible()
  const worldState = defaultWorld(cast)
  const sceneState = defaultScene(cast)
  const assetPins = input.assetPins ?? {
    placeId: null,
    placeBackgroundId: null,
    characterSprites: {}
  }

  db()
    .prepare(`
      INSERT INTO nsfw_story_sessions(
        id, owner_user_id, format, title, premise, duration, tone, perspective,
        interaction_policy, generation_profile, model_alias, head_beat_id, revision,
        plan_json, bible_json, world_state_json, scene_state_json, cast_json,
        interests_json, exclusions_json, archived, privacy_notice_seen, created_at, updated_at,
        asset_pins_json, escalation_heart, experience_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, 0, ?)
    `)
    .run(
      id,
      ownerUserId,
      input.format,
      input.title.trim() || 'Historia sin título',
      input.premise.trim(),
      input.duration,
      input.tone,
      input.perspective,
      input.interactionPolicy,
      input.generationProfile,
      input.modelAlias,
      json(plan),
      json(bible),
      json(worldState),
      json(sceneState),
      json(cast),
      json(input.interests.slice(0, MAX_PRIMARY_INTERESTS)),
      json(input.exclusions),
      now,
      now,
      json(assetPins),
      input.experienceId ?? null
    )

  return getStorySession(id, ownerUserId)!
}

export function getStorySession(sessionId: string, ownerUserId: string) {
  const row = db()
    .prepare('SELECT * FROM nsfw_story_sessions WHERE id = ? AND owner_user_id = ?')
    .get(sessionId, ownerUserId) as SessionRow | undefined
  return row ? rowToSession(row) : null
}

/**
 * Solo se listan las historias que han empezado de verdad: una sesión creada
 * y abandonada antes del primer beat no cuenta como guardada.
 * ponytail: purga las vacías con más de 24 h; si molesta, moverlo a un job.
 */
export function listStorySessions(ownerUserId: string, options: { archived?: boolean } = {}) {
  const archived = options.archived ? 1 : 0
  db()
    .prepare(`
      DELETE FROM nsfw_story_sessions
      WHERE owner_user_id = ?
        AND created_at < ?
        AND NOT EXISTS (SELECT 1 FROM nsfw_beats WHERE session_id = nsfw_story_sessions.id)
    `)
    .run(ownerUserId, Date.now() - 24 * 60 * 60 * 1000)

  const rows = db()
    .prepare(`
      SELECT * FROM nsfw_story_sessions
      WHERE owner_user_id = ? AND archived = ?
        AND EXISTS (SELECT 1 FROM nsfw_beats WHERE session_id = nsfw_story_sessions.id)
      ORDER BY updated_at DESC
    `)
    .all(ownerUserId, archived) as SessionRow[]
  return rows.map(rowToSession)
}

export function getPlayState(sessionId: string, ownerUserId: string): SessionPlayState | null {
  const session = getStorySession(sessionId, ownerUserId)
  if (!session) return null
  const beats = (
    db()
      .prepare(`
        SELECT * FROM nsfw_beats
        WHERE session_id = ?
        ORDER BY sequence ASC
      `)
      .all(sessionId) as BeatRow[]
  ).map(rowToBeat)

  const active = db()
    .prepare(`
      SELECT * FROM nsfw_generation_attempts
      WHERE session_id = ?
        AND state IN ('requested', 'streaming', 'validating', 'ready', 'failed')
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(sessionId) as AttemptRow | undefined

  let siblingAttempts: NsfwGenerationAttempt[] = []
  if (active) {
    siblingAttempts = (
      db()
        .prepare(`
          SELECT * FROM nsfw_generation_attempts
          WHERE session_id = ? AND sibling_group_id = ?
          ORDER BY created_at ASC
        `)
        .all(sessionId, active.sibling_group_id) as AttemptRow[]
    ).map(rowToAttempt)
  }

  return {
    session,
    beats,
    activeAttempt: active ? rowToAttempt(active) : null,
    siblingAttempts
  }
}

export function getAttempt(attemptId: string, ownerUserId: string) {
  const row = db()
    .prepare(`
      SELECT a.*
      FROM nsfw_generation_attempts a
      JOIN nsfw_story_sessions s ON s.id = a.session_id
      WHERE a.id = ? AND s.owner_user_id = ?
    `)
    .get(attemptId, ownerUserId) as AttemptRow | undefined
  return row ? rowToAttempt(row) : null
}

export function createAttempt(params: {
  session: NsfwStorySession
  input: PlayerInput
  modelAlias: string
  modelId: string
  generationProfile: GenerationProfile
  siblingGroupId?: string
  skillVersions?: Record<string, string>
}) {
  const now = Date.now()
  const id = randomUUID()
  const parentBeatId = params.session.headBeatId
  const inputFingerprint = makeFingerprint(params.input, params.session.revision, parentBeatId)
  const siblingGroupId = params.siblingGroupId ?? randomUUID()

  const active = db()
    .prepare(`
      SELECT id FROM nsfw_generation_attempts
      WHERE session_id = ?
        AND state IN ('requested', 'streaming', 'validating', 'ready')
      LIMIT 1
    `)
    .get(params.session.id) as { id: string } | undefined
  if (active) {
    throw createError({ statusCode: 409, statusMessage: 'Ya hay una generación activa' })
  }

  db()
    .prepare(`
      INSERT INTO nsfw_generation_attempts(
        id, session_id, parent_beat_id, sibling_group_id, input_json, input_fingerprint,
        model_alias, model_id, generation_profile, state, envelope_json, provisional_text,
        error_message, usage_json, retry_count, created_at, updated_at,
        skill_versions_json, pipeline_passes_json, latency_ms, thumb
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', NULL, '', NULL, ?, 0, ?, ?, ?, '[]', 0, NULL)
    `)
    .run(
      id,
      params.session.id,
      parentBeatId,
      siblingGroupId,
      json(params.input),
      inputFingerprint,
      params.modelAlias,
      params.modelId,
      params.generationProfile,
      json({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
      now,
      now,
      json(params.skillVersions ?? {})
    )

  db()
    .prepare(`
      UPDATE nsfw_story_sessions
      SET generation_profile = ?, model_alias = ?, updated_at = ?
      WHERE id = ?
    `)
    .run(params.generationProfile, params.modelAlias, now, params.session.id)

  return getAttempt(id, params.session.ownerUserId)!
}

export function updateAttempt(
  attemptId: string,
  patch: Partial<{
    state: AttemptState
    envelope: GenerationEnvelope | null
    provisionalText: string
    errorMessage: string | null
    usage: GenerationUsage
    retryCount: number
    skillVersions: Record<string, string>
    pipelinePasses: NsfwGenerationAttempt['pipelinePasses']
    latencyMs: number
    thumb: 'up' | 'down' | null
  }>
) {
  const current = db()
    .prepare('SELECT * FROM nsfw_generation_attempts WHERE id = ?')
    .get(attemptId) as AttemptRow | undefined
  if (!current) return null

  const next = {
    state: patch.state ?? (current.state as AttemptState),
    envelope:
      patch.envelope !== undefined
        ? patch.envelope
        : current.envelope_json
          ? parseJson(current.envelope_json, null)
          : null,
    provisionalText: patch.provisionalText ?? current.provisional_text,
    errorMessage: patch.errorMessage !== undefined ? patch.errorMessage : current.error_message,
    usage: patch.usage ?? parseJson(current.usage_json, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
    retryCount: patch.retryCount ?? current.retry_count,
    skillVersions:
      patch.skillVersions ??
      parseJson(current.skill_versions_json ?? '{}', {} as Record<string, string>),
    pipelinePasses:
      patch.pipelinePasses ??
      parseJson(current.pipeline_passes_json ?? '[]', [] as NsfwGenerationAttempt['pipelinePasses']),
    latencyMs: patch.latencyMs ?? integer(current.latency_ms ?? 0),
    thumb:
      patch.thumb !== undefined
        ? patch.thumb
        : current.thumb === 'up' || current.thumb === 'down'
          ? current.thumb
          : null
  }

  db()
    .prepare(`
      UPDATE nsfw_generation_attempts
      SET state = ?, envelope_json = ?, provisional_text = ?, error_message = ?,
          usage_json = ?, retry_count = ?, skill_versions_json = ?, pipeline_passes_json = ?,
          latency_ms = ?, thumb = ?, updated_at = ?
      WHERE id = ?
    `)
    .run(
      next.state,
      next.envelope ? json(next.envelope) : null,
      next.provisionalText,
      next.errorMessage,
      json(next.usage),
      next.retryCount,
      json(next.skillVersions),
      json(next.pipelinePasses ?? []),
      next.latencyMs,
      next.thumb,
      Date.now(),
      attemptId
    )

  return rowToAttempt({
    ...current,
    state: next.state,
    envelope_json: next.envelope ? json(next.envelope) : null,
    provisional_text: next.provisionalText,
    error_message: next.errorMessage,
    usage_json: json(next.usage),
    retry_count: next.retryCount,
    skill_versions_json: json(next.skillVersions),
    pipeline_passes_json: json(next.pipelinePasses ?? []),
    latency_ms: next.latencyMs,
    thumb: next.thumb,
    updated_at: Date.now()
  })
}

export function acceptAttempt(session: NsfwStorySession, attempt: NsfwGenerationAttempt) {
  if (attempt.state !== 'ready' || !attempt.envelope) {
    throw createError({ statusCode: 409, statusMessage: 'El intento no está listo' })
  }
  const expected = makeFingerprint(attempt.input, session.revision, session.headBeatId)
  if (expected !== attempt.inputFingerprint) {
    updateAttempt(attempt.id, { state: 'stale' })
    throw createError({ statusCode: 409, statusMessage: 'El intento está obsoleto' })
  }

  const now = Date.now()
  const beatId = randomUUID()
  const sequence =
    (
      db()
        .prepare('SELECT COUNT(*) AS total FROM nsfw_beats WHERE session_id = ?')
        .get(session.id) as { total: number }
    ).total + 1

  const nextPlan = applyPlanPatch(session.plan, attempt.envelope.planPatch)
  const nextWorld = applyStateDelta(session.worldState, attempt.envelope.stateDelta)
  const nextScene: SceneState = {
    location: nextWorld.location,
    presentActorIds: nextWorld.presentActorIds,
    intention: attempt.input.text.slice(0, 120) || session.sceneState.intention,
    pacing: session.sceneState.pacing
  }

  getStorage().transaction(() => {
    db()
      .prepare(`
        INSERT INTO nsfw_beats(
          id, session_id, parent_beat_id, accepted_attempt_id, envelope_json, sequence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        beatId,
        session.id,
        session.headBeatId,
        attempt.id,
        json(attempt.envelope),
        sequence,
        now
      )

    db()
      .prepare(`
        UPDATE nsfw_generation_attempts
        SET state = 'accepted', updated_at = ?
        WHERE id = ?
      `)
      .run(now, attempt.id)

    db()
      .prepare(`
        UPDATE nsfw_story_sessions
        SET head_beat_id = ?, revision = revision + 1, plan_json = ?, world_state_json = ?,
            scene_state_json = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(beatId, json(nextPlan), json(nextWorld), json(nextScene), now, session.id)

    if (attempt.usage.totalTokens > 0) {
      db()
        .prepare(`
          INSERT INTO nsfw_generation_usage(
            id, session_id, attempt_id, category, prompt_tokens, completion_tokens, total_tokens, created_at
          ) VALUES (?, ?, ?, 'accepted', ?, ?, ?, ?)
        `)
        .run(
          randomUUID(),
          session.id,
          attempt.id,
          attempt.usage.promptTokens,
          attempt.usage.completionTokens,
          attempt.usage.totalTokens,
          now
        )
    }
  })

  return getPlayState(session.id, session.ownerUserId)!
}

export function discardAttempt(attemptId: string) {
  return updateAttempt(attemptId, { state: 'discarded' })
}

export function selectSiblingAttempt(ownerUserId: string, attemptId: string) {
  const attempt = getAttempt(attemptId, ownerUserId)
  if (!attempt) throw createError({ statusCode: 404, statusMessage: 'Intento no encontrado' })
  if (!['ready', 'discarded', 'failed'].includes(attempt.state)) {
    throw createError({ statusCode: 409, statusMessage: 'El intento no es seleccionable' })
  }

  const siblings = db()
    .prepare(`
      SELECT id, state FROM nsfw_generation_attempts
      WHERE session_id = ? AND sibling_group_id = ?
    `)
    .all(attempt.sessionId, attempt.siblingGroupId) as Array<{ id: string; state: string }>

  for (const sibling of siblings) {
    if (sibling.state === 'ready' && sibling.id !== attempt.id) {
      updateAttempt(sibling.id, { state: 'discarded' })
    }
  }

  if (attempt.state === 'discarded') {
    updateAttempt(attempt.id, { state: 'ready' })
  }

  return getPlayState(attempt.sessionId, ownerUserId)!
}

export function prepareRerollSource(ownerUserId: string, attemptId: string) {
  const attempt = getAttempt(attemptId, ownerUserId)
  if (!attempt) throw createError({ statusCode: 404, statusMessage: 'Intento no encontrado' })
  if (!['ready', 'discarded', 'failed'].includes(attempt.state)) {
    throw createError({ statusCode: 409, statusMessage: 'No se puede re-lanzar este intento' })
  }
  if (attempt.state === 'ready') {
    updateAttempt(attempt.id, { state: 'discarded' })
  }
  const active = db()
    .prepare(`
      SELECT id FROM nsfw_generation_attempts
      WHERE session_id = ?
        AND state IN ('requested', 'streaming', 'validating', 'ready')
      LIMIT 1
    `)
    .get(attempt.sessionId) as { id: string } | undefined
  if (active) updateAttempt(active.id, { state: 'discarded' })
  return attempt
}

export function setEscalationHeart(sessionId: string, ownerUserId: string, value: boolean) {
  const session = getStorySession(sessionId, ownerUserId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })
  db()
    .prepare(`
      UPDATE nsfw_story_sessions
      SET escalation_heart = ?, updated_at = ?
      WHERE id = ?
    `)
    .run(value ? 1 : 0, Date.now(), sessionId)
  return getStorySession(sessionId, ownerUserId)!
}

export function setSessionAssetPins(
  sessionId: string,
  ownerUserId: string,
  pins: SessionAssetPins
) {
  const session = getStorySession(sessionId, ownerUserId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })
  db()
    .prepare(`
      UPDATE nsfw_story_sessions
      SET asset_pins_json = ?, updated_at = ?
      WHERE id = ?
    `)
    .run(json(pins), Date.now(), sessionId)
  return getStorySession(sessionId, ownerUserId)!
}

export function setSessionArchived(sessionId: string, ownerUserId: string, archived: boolean) {
  const session = getStorySession(sessionId, ownerUserId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })
  db()
    .prepare('UPDATE nsfw_story_sessions SET archived = ?, updated_at = ? WHERE id = ?')
    .run(archived ? 1 : 0, Date.now(), sessionId)
  return getStorySession(sessionId, ownerUserId)!
}

export function finalizeSession(sessionId: string, ownerUserId: string) {
  const session = getStorySession(sessionId, ownerUserId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })
  const now = Date.now()
  db()
    .prepare('UPDATE nsfw_story_sessions SET finalized_at = ?, updated_at = ? WHERE id = ?')
    .run(now, now, sessionId)
  return getStorySession(sessionId, ownerUserId)!
}

export function updateCastMember(
  sessionId: string,
  ownerUserId: string,
  actorId: string,
  patch: Partial<SessionCastMember>
) {
  const session = getStorySession(sessionId, ownerUserId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })
  const cast = session.cast.map((member) =>
    member.actorId === actorId
      ? {
          ...member,
          ...patch,
          actorId: member.actorId,
          role: member.role
        }
      : member
  )
  db()
    .prepare(`
      UPDATE nsfw_story_sessions
      SET cast_json = ?, revision = revision + 1, updated_at = ?
      WHERE id = ?
    `)
    .run(json(cast), Date.now(), sessionId)
  return getStorySession(sessionId, ownerUserId)!
}

export function updateStoryPlan(
  sessionId: string,
  ownerUserId: string,
  patch: { summary?: string; nextBeats?: StoryPlan['nextBeats'] }
) {
  const session = getStorySession(sessionId, ownerUserId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })
  const next: StoryPlan = {
    version: session.plan.version + 1,
    summary: patch.summary?.trim() || session.plan.summary,
    nextBeats: patch.nextBeats ?? session.plan.nextBeats
  }
  db()
    .prepare(`
      UPDATE nsfw_story_sessions
      SET plan_json = ?, revision = revision + 1, updated_at = ?
      WHERE id = ?
    `)
    .run(json(next), Date.now(), sessionId)
  return getStorySession(sessionId, ownerUserId)!
}

export function updateStorySessionConfig(
  sessionId: string,
  ownerUserId: string,
  patch: {
    title?: string
    premise?: string
    duration?: string
    tone?: string
    perspective?: string
    interactionPolicy?: InteractionPolicy
    generationProfile?: GenerationProfile
    modelAlias?: string
    interests?: string[]
    exclusions?: string[]
  }
) {
  const session = getStorySession(sessionId, ownerUserId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })
  if (session.finalizedAt) {
    throw createError({ statusCode: 409, statusMessage: 'Sesión finalizada' })
  }

  const format = session.format as CreatorFormat
  const coherent = coherentConfiguration({
    format,
    profile: (patch.generationProfile || session.generationProfile) as GenerationProfile,
    tone: sessionToneToCreator(patch.tone ?? session.tone),
    perspective: sessionPerspectiveToCreator(patch.perspective ?? session.perspective),
    duration: (patch.duration || session.duration) as StoryDuration,
    interactionPolicy: (patch.interactionPolicy ||
      session.interactionPolicy) as InteractionPolicy
  })

  const title = typeof patch.title === 'string' ? patch.title.trim() || session.title : session.title
  const premise =
    typeof patch.premise === 'string' ? patch.premise.trim() || session.premise : session.premise
  const interests = Array.isArray(patch.interests)
    ? patch.interests.map((item) => item.trim()).filter(Boolean).slice(0, MAX_PRIMARY_INTERESTS)
    : session.interests
  const exclusions = Array.isArray(patch.exclusions)
    ? patch.exclusions.map((item) => item.trim()).filter(Boolean)
    : session.exclusions
  const modelAlias =
    typeof patch.modelAlias === 'string' && patch.modelAlias.trim()
      ? patch.modelAlias.trim()
      : session.modelAlias

  db()
    .prepare(`
      UPDATE nsfw_story_sessions
      SET title = ?, premise = ?, duration = ?, tone = ?, perspective = ?,
          interaction_policy = ?, generation_profile = ?, model_alias = ?,
          interests_json = ?, exclusions_json = ?,
          revision = revision + 1, updated_at = ?
      WHERE id = ? AND owner_user_id = ?
    `)
    .run(
      title,
      premise,
      coherent.duration,
      mapToneToSession(coherent.tone),
      mapPerspectiveToSession(coherent.perspective),
      coherent.interactionPolicy,
      coherent.profile,
      modelAlias,
      json(interests),
      json(exclusions),
      Date.now(),
      sessionId,
      ownerUserId
    )

  return getStorySession(sessionId, ownerUserId)!
}

function sessionToneToCreator(tone: string): NarrativeTone {
  if (tone === 'romantic') return 'romantic'
  if (tone === 'explicit' || tone === 'hardcore') return 'hardcore'
  if (tone === 'dark') return 'dark'
  return 'neutral'
}

function sessionPerspectiveToCreator(perspective: string): NarrativePerspective {
  if (perspective === 'first') return 'first'
  if (perspective === 'third') return 'third'
  if (perspective === 'narrative') return 'narrative'
  return 'second'
}

export function syncBibleFact(
  sessionId: string,
  ownerUserId: string,
  fact: { id?: string; entity: string; text: string; secret?: boolean; knownByProtagonist?: boolean }
) {
  const session = getStorySession(sessionId, ownerUserId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })
  const bible = {
    version: session.bible.version + 1,
    facts: [...session.bible.facts]
  }
  const id = fact.id?.trim() || randomUUID()
  const existing = bible.facts.findIndex((item) => item.id === id)
  const nextFact = {
    id,
    entity: fact.entity.trim(),
    text: fact.text.trim(),
    secret: Boolean(fact.secret),
    knownByProtagonist: Boolean(fact.knownByProtagonist),
    source: 'user-edit'
  }
  if (!nextFact.entity || !nextFact.text) {
    throw createError({ statusCode: 400, statusMessage: 'Hecho incompleto' })
  }
  if (existing >= 0) bible.facts[existing] = nextFact
  else bible.facts.push(nextFact)

  db()
    .prepare(`
      UPDATE nsfw_story_sessions
      SET bible_json = ?, revision = revision + 1, updated_at = ?
      WHERE id = ?
    `)
    .run(json(bible), Date.now(), sessionId)

  return getStorySession(sessionId, ownerUserId)!
}

export function forkFromBeat(ownerUserId: string, beatId: string, branchLabel?: string) {
  const sourceBeat = db()
    .prepare(`
      SELECT b.*, s.owner_user_id
      FROM nsfw_beats b
      JOIN nsfw_story_sessions s ON s.id = b.session_id
      WHERE b.id = ?
    `)
    .get(beatId) as (BeatRow & { owner_user_id: string }) | undefined
  if (!sourceBeat || sourceBeat.owner_user_id !== ownerUserId) {
    throw createError({ statusCode: 404, statusMessage: 'Beat no encontrado' })
  }

  const source = getStorySession(sourceBeat.session_id, ownerUserId)
  if (!source) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })

  const ancestorBeats = (
    db()
      .prepare(`
        SELECT * FROM nsfw_beats
        WHERE session_id = ? AND sequence <= ?
        ORDER BY sequence ASC
      `)
      .all(source.id, sourceBeat.sequence) as BeatRow[]
  ).map(rowToBeat)

  let plan = defaultPlan(source.plan.summary)
  let world = defaultWorld(source.cast)
  let scene = defaultScene(source.cast)
  for (const beat of ancestorBeats) {
    plan = applyPlanPatch(plan, beat.envelope.planPatch)
    world = applyStateDelta(world, beat.envelope.stateDelta)
    scene = {
      location: world.location,
      presentActorIds: world.presentActorIds,
      intention: scene.intention,
      pacing: scene.pacing
    }
  }

  const now = Date.now()
  const newSessionId = randomUUID()
  const label =
    branchLabel?.trim() ||
    `Rama ${new Date(now).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}`

  db()
    .prepare(`
      INSERT INTO nsfw_story_sessions(
        id, owner_user_id, format, title, premise, duration, tone, perspective,
        interaction_policy, generation_profile, model_alias, head_beat_id, revision,
        plan_json, bible_json, world_state_json, scene_state_json, cast_json,
        interests_json, exclusions_json, archived, privacy_notice_seen,
        parent_session_id, fork_beat_id, sequel_of_session_id, branch_label, finalized_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, NULL, ?, NULL, ?, ?)
    `)
    .run(
      newSessionId,
      ownerUserId,
      source.format,
      `${source.title} · ${label}`,
      source.premise,
      source.duration,
      source.tone,
      source.perspective,
      source.interactionPolicy,
      source.generationProfile,
      source.modelAlias,
      ancestorBeats.length,
      json(plan),
      json(source.bible),
      json(world),
      json(scene),
      json(source.cast),
      json(source.interests),
      json(source.exclusions),
      source.id,
      beatId,
      label,
      now,
      now
    )

  const idMap = new Map<string, string>()
  let previousNewId: string | null = null
  for (const beat of ancestorBeats) {
    const newBeatId = randomUUID()
    idMap.set(beat.id, newBeatId)
    db()
      .prepare(`
        INSERT INTO nsfw_beats(
          id, session_id, parent_beat_id, accepted_attempt_id, envelope_json, sequence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        newBeatId,
        newSessionId,
        previousNewId,
        beat.acceptedAttemptId,
        json(beat.envelope),
        beat.sequence,
        beat.createdAt
      )
    previousNewId = newBeatId
  }

  if (previousNewId) {
    db()
      .prepare('UPDATE nsfw_story_sessions SET head_beat_id = ? WHERE id = ?')
      .run(previousNewId, newSessionId)
  }

  return getStorySession(newSessionId, ownerUserId)!
}

export function createSequel(sessionId: string, ownerUserId: string) {
  const source = getStorySession(sessionId, ownerUserId)
  if (!source) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })
  if (!source.finalizedAt) {
    finalizeSession(sessionId, ownerUserId)
  }

  const now = Date.now()
  const newSessionId = randomUUID()
  const premise = `Secuela de «${source.title}». Continúa tras el final registrado, con los mismos personajes y una nueva tensión.`

  db()
    .prepare(`
      INSERT INTO nsfw_story_sessions(
        id, owner_user_id, format, title, premise, duration, tone, perspective,
        interaction_policy, generation_profile, model_alias, head_beat_id, revision,
        plan_json, bible_json, world_state_json, scene_state_json, cast_json,
        interests_json, exclusions_json, archived, privacy_notice_seen,
        parent_session_id, fork_beat_id, sequel_of_session_id, branch_label, finalized_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?, 0, 1, NULL, NULL, ?, ?, NULL, ?, ?)
    `)
    .run(
      newSessionId,
      ownerUserId,
      source.format,
      `${source.title} · Secuela`,
      premise,
      source.duration,
      source.tone,
      source.perspective,
      source.interactionPolicy,
      source.generationProfile,
      source.modelAlias,
      json(defaultPlan('Abrir la secuela sin spoilear el final anterior.')),
      json({ version: 1, facts: source.bible.facts.filter((fact) => !fact.secret || fact.knownByProtagonist) }),
      json(defaultWorld(source.cast)),
      json(defaultScene(source.cast)),
      json(source.cast),
      json(source.interests),
      json(source.exclusions),
      source.id,
      'Secuela',
      now,
      now
    )

  return getStorySession(newSessionId, ownerUserId)!
}

function applyStateDelta(state: WorldState, ops: GenerationEnvelope['stateDelta']): WorldState {
  const next: WorldState = {
    ...state,
    version: state.version + 1,
    relationshipNotes: [...state.relationshipNotes],
    flags: { ...state.flags },
    presentActorIds: [...state.presentActorIds]
  }
  for (const op of ops) {
    if (op.op === 'set_location') next.location = op.value
    else if (op.op === 'set_mood') next.mood = op.value
    else if (op.op === 'set_present') next.presentActorIds = [...op.actorIds]
    else if (op.op === 'set_flag') next.flags[op.key] = op.value
    else if (op.op === 'add_relationship_note') next.relationshipNotes.push(op.value)
  }
  return next
}

function applyPlanPatch(plan: StoryPlan, ops: GenerationEnvelope['planPatch']): StoryPlan {
  const next: StoryPlan = {
    version: plan.version + 1,
    summary: plan.summary,
    nextBeats: plan.nextBeats.map((beat) => ({ ...beat }))
  }
  for (const op of ops) {
    if (op.op === 'set_summary') next.summary = op.value
    else if (op.op === 'mark_beat_done') {
      const beat = next.nextBeats.find((item) => item.id === op.beatId)
      if (beat) beat.status = 'done'
    } else if (op.op === 'add_beat') {
      next.nextBeats.push({ id: op.id, intent: op.intent, status: 'pending' })
    }
  }
  return next
}
