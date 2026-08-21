import type { GenerationEnvelope } from '../../../shared/types/nsfw/envelope.ts'
import type {
  NsfwNarrativeBeat,
  NsfwStorySession,
  PlayerInput
} from '../../../shared/types/nsfw/session.ts'
import {
  RAG_VERSION,
  normalizeInteractionPolicy,
  normalizeNarrativeFormat,
  normalizeTone,
  renderNarrativeRags,
  resolveEffectivePerspective,
  selectNarrativeRags
} from './narrativeRag.ts'
import { skillsPromptBlock } from './skills.ts'

const FORMAT_CONTRACTS: Record<string, string> = {
  story: '200–600 palabras, prosa sensorial moderada y diálogo sustancial.',
  chat: '40–150 palabras, diálogo dominante y narrador conciso.',
  visual_novel: '60–220 palabras, diálogo dominante, bloques breves y cues visuales existentes.'
}

const INTERACTION_CONTRACTS: Record<string, string> = {
  pause: 'Detente en un punto natural de intervención y ofrece choices contextuales; la persona decide cada beat.',
  lite_choices:
    'Detente en un punto natural y ofrece entre dos y cinco choices contextuales con prominencia distinta; una respuesta abierta sigue siendo válida.',
  automatic_checkpoints:
    'Continúa sin pausa entre beats y solo usa stopReason choice_required cuando haya una decisión significativa; en otro caso awaiting_player o natural_pause.',
  non_interactive:
    'No ofrezcas choices ni pidas decisiones. Continúa la narración de forma autónoma y usa stopReason scene_complete al cerrar la historia.'
}

const DURATION_CONTRACTS: Record<string, string> = {
  encounter:
    'Objetivo orientativo de 12–20 beats: introduce el contexto pronto y construye una escalada clara. Si encaja un encuentro adulto consentido, ocupa aproximadamente la mitad del recorrido sin saltar escalada, reacción ni cierre.',
  short:
    'Objetivo orientativo de 30–60 beats: alterna desarrollo, diálogo, tensión y consecuencias. No sacrifiques agencia ni continuidad para llegar antes a un hito adulto.',
  medium:
    'Objetivo orientativo de 80–160 beats: construye varios movimientos de conflicto, relación y consecuencias antes de resolverlos.',
  long:
    'Objetivo orientativo de 180–350 beats: construye arcos sostenidos, cambios de relación y consecuencias duraderas. El plan puede revisarse por decisiones aceptadas, pero no resuelvas conflictos prematuramente.',
  open: 'No hay objetivo de beats fijo. Mantén una progresión con propósito, revisa el plan según las decisiones aceptadas y no fuerces un final.'
}

const SCENE_METHOD_QUALITY = [
  'Método interno (no lo imprimas): anclar lugar/participantes/conocimiento; definir el cambio del beat; elegir foco; comprobar agencia; regular intensidad; comprobar cuerpo y assets; cerrar en punto natural; extraer estado al envelope.',
  'Separa internamente planificación, escritura, crítica y validación; devuelve solo el JSON revisado.'
].join(' ')

const SCENE_METHOD_QUICK =
  'Haz una planificación breve interna antes de escribir y valida el JSON final. Un beat, un cambio.'

export interface PromptBundleOptions {
  recentBeats?: NsfwNarrativeBeat[]
}

function compactJson(value: unknown) {
  return JSON.stringify(value, null, 0)
}

function normalizeDuration(duration: string) {
  const value = duration.trim().toLowerCase()
  if (value === 'corta' || value === 'short' || value === 'encuentro' || value === 'encounter') {
    return value === 'encuentro' || value === 'encounter' ? 'encounter' : 'short'
  }
  if (value === 'larga' || value === 'long') return 'long'
  if (value === 'open' || value === 'abierta' || value === 'abierto') return 'open'
  return 'medium'
}

function publicBibleFacts(session: NsfwStorySession) {
  return (session.bible?.facts || [])
    .filter((fact) => !fact.secret || fact.knownByProtagonist)
    .map((fact) => ({
      id: fact.id,
      entity: fact.entity,
      text: fact.text,
      source: fact.source
    }))
}

function recentUnits(beats: NsfwNarrativeBeat[]) {
  return beats.slice(-6).map((beat) => ({
    sequence: beat.sequence,
    units: beat.envelope.visibleUnits.map((unit) =>
      unit.type === 'dialogue'
        ? { type: unit.type, actorId: unit.actorId, text: unit.text }
        : { type: unit.type, text: unit.text }
    )
  }))
}

export function buildStoryPromptBundle(
  session: NsfwStorySession,
  input: PlayerInput,
  options: PromptBundleOptions = {}
) {
  const formatKey = normalizeNarrativeFormat(session.format)
  const toneKey = normalizeTone(session.tone)
  const durationKey = normalizeDuration(session.duration)
  const autonomous =
    formatKey !== 'chat' &&
    (session.interactionPolicy === 'non_interactive' ||
      resolveEffectivePerspective({
        format: session.format,
        perspective: session.perspective,
        interactionPolicy: session.interactionPolicy
      }) === 'narrative')
  const effectiveInteraction = autonomous
    ? 'non_interactive'
    : normalizeInteractionPolicy(session.interactionPolicy)
  const rags = selectNarrativeRags({
    format: session.format,
    perspective: session.perspective,
    tone: session.tone,
    interactionPolicy: effectiveInteraction
  })

  let agencyInstruction =
    'Avanza exactamente una unidad narrativa. No elijas acciones, pensamientos, palabras ni decisiones de la persona usuaria.'
  if (autonomous) {
    agencyInstruction =
      'Avanza exactamente una unidad narrativa autónoma. Puedes decidir por todos los personajes y no debes ofrecer choices.'
  } else if (effectiveInteraction === 'non_interactive') {
    agencyInstruction =
      'Continúa el RP sin choices, pero no inventes acciones, palabras, pensamientos ni consentimiento de la persona usuaria.'
  }

  const pins = session.assetPins ?? {
    placeId: null,
    placeBackgroundId: null,
    characterSprites: {}
  }
  const allowedActorIds = session.cast.map((member) => member.actorId).sort()
  const allowedAssetIds = [
    pins.placeId,
    pins.placeBackgroundId,
    ...Object.values(pins.characterSprites)
  ].filter((id): id is string => Boolean(id))

  const system = [
    'Eres el motor narrativo privado de Mis Historias.',
    'Escribe directamente en castellano de España; no traduzcas desde inglés.',
    `Contrato de formato: ${session.format}. ${FORMAT_CONTRACTS[formatKey]}`,
    `Interacción efectiva: ${effectiveInteraction}. ${INTERACTION_CONTRACTS[effectiveInteraction] || INTERACTION_CONTRACTS.pause} Tono: ${toneKey}. Perspectiva solicitada: ${session.perspective}.`,
    `Duración: ${durationKey}. ${DURATION_CONTRACTS[durationKey] || DURATION_CONTRACTS.medium}`,
    agencyInstruction,
    'No aceleres una relación o escena adulta solo porque esté permitida. Mantén consentimiento, continuidad y ritmo.',
    'Los intereses principales pueden reaparecer sin dominarlo todo; las exclusiones no deben aparecer ni sugerirse.',
    `Exclusiones (prohibidas): ${session.exclusions.join(', ') || '(ninguna)'}.`,
    `Intereses: ${session.interests.join(', ') || '(ninguno)'}.`,
    'visibleUnits: narration|dialogue. dialogue requiere actorId del reparto. No inventes actorId. No uses HTML.',
    'speech, expression y action son campos estructurados opcionales; nunca texto visible ni markdown.',
    'stateDelta y planPatch son operaciones tipadas, no prosa. bible no se reescribe en prosa.',
    'stopReason: awaiting_player|natural_pause|choice_required|scene_complete.',
    `Solo los IDs de actor autorizados pueden aparecer en actorId: ${compactJson(allowedActorIds)}`,
    allowedAssetIds.length
      ? `Solo los assets autorizados pueden aparecer en cues: ${compactJson(allowedAssetIds)}`
      : 'No inventes IDs de sprite, fondo ni CG.',
    session.format === 'vn'
      ? 'Para visualCues elige composition o scene_cg con assets pineados; nunca inventes un ID.'
      : 'visualCues vacío salvo que el formato lo requiera.',
    session.generationProfile === 'quality' ? SCENE_METHOD_QUALITY : SCENE_METHOD_QUICK,
    'Devuelve exclusivamente JSON Generation Envelope válido: schemaVersion 1, language es-ES, format, visibleUnits, visualCues, soundCues, choices, stateDelta, planPatch y stopReason.',
    `RAGS EDITORIALES ACTIVOS (${RAG_VERSION}):`,
    renderNarrativeRags(rags),
    'Skills de contrato:',
    skillsPromptBlock(session.format)
  ].join('\n')

  const context = {
    characters: session.cast.map((member) => ({
      actorId: member.actorId,
      name: member.overrideName || member.name,
      role: member.role,
      personality: member.personality,
      isSelfInsert: member.isSelfInsert,
      characterization: member.characterization || '',
      preservedRelations: member.preservedRelations || []
    })),
    visualAssets: {
      placeId: pins.placeId,
      placeBackgroundId: pins.placeBackgroundId,
      characterSprites: pins.characterSprites
    },
    adultProfile: {
      tone: toneKey,
      interests: session.interests,
      exclusions: session.exclusions
    },
    worldState: session.worldState,
    sceneState: session.sceneState,
    mutablePlan: session.plan,
    storyBible: publicBibleFacts(session),
    recentUnits: recentUnits(options.recentBeats || []),
    playerInput: input,
    title: session.title,
    premise: session.premise
  }

  const user = ['CONTEXTO AUTORIZADO:', compactJson(context)].join('\n')

  return {
    messages: [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user }
    ],
    ragVersion: RAG_VERSION,
    ragIds: rags.map((rag) => rag.id),
    effectiveInteraction,
    formatKey,
    toneKey
  }
}

export function buildMockEnvelope(session: NsfwStorySession, input: PlayerInput): GenerationEnvelope {
  const protagonist = session.cast.find((member) => member.role === 'protagonist')
  const other = session.cast.find((member) => member.role === 'character')
  const action =
    input.text.trim() ||
    (input.kind === 'speak' ? 'hablas con voz baja' : 'miras alrededor y das un paso adelante')

  const units: GenerationEnvelope['visibleUnits'] = [
    {
      type: 'narration',
      text: `La escena se abre sobre ${session.worldState.location === 'Por definir' ? 'un umbral apenas iluminado' : session.worldState.location}. El aire guarda la promesa de lo que ${protagonist?.name || 'tú'} acabas de decidir.`
    }
  ]

  if (other) {
    units.push({
      type: 'dialogue',
      actorId: other.actorId,
      text: `Te observo. ${action.charAt(0).toUpperCase()}${action.slice(1)}… sigue. Quiero saber hasta dónde llegas.`,
      speech: 'soft'
    })
  } else {
    units.push({
      type: 'narration',
      text: `Tras ${action}, el silencio responde con un latido más cercano. Todavía puedes elegir el siguiente gesto.`
    })
  }

  const autonomous =
    session.format !== 'chat' &&
    (session.interactionPolicy === 'non_interactive' ||
      resolveEffectivePerspective({
        format: session.format,
        perspective: session.perspective,
        interactionPolicy: session.interactionPolicy
      }) === 'narrative')

  return {
    schemaVersion: 1,
    language: 'es-ES',
    format: session.format,
    visibleUnits: units,
    visualCues:
      session.format === 'vn'
        ? [{ kind: 'scene_cg', sceneCgAssetId: `cg-${session.worldState.location || 'umbral'}` }]
        : [],
    soundCues: [],
    choices: autonomous
      ? []
      : [
          { id: 'c1', kind: 'speak', label: 'Preguntar qué espera de ti', prominence: 'primary' },
          { id: 'c2', kind: 'act', label: 'Acercarte sin hablar', prominence: 'secondary' },
          { id: 'c3', kind: 'act', label: 'Detenerte y observar', prominence: 'secondary' }
        ],
    stateDelta: [
      { op: 'set_location', value: session.worldState.location === 'Por definir' ? 'Umbral' : session.worldState.location },
      { op: 'set_mood', value: 'tensa' }
    ],
    planPatch: [{ op: 'mark_beat_done', beatId: 'beat-open' }],
    stopReason: autonomous ? 'scene_complete' : 'awaiting_player'
  }
}
