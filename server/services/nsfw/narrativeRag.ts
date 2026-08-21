export const RAG_VERSION = 'narrative-rag-v1'

export interface NarrativeRag {
  id: string
  instructions: readonly string[]
}

export const COMMON_LITERARY: NarrativeRag = {
  id: 'literary-quality-es',
  instructions: [
    'Cada beat debe cambiar algo: información, tensión, relación, intención, riesgo o estado físico/emocional.',
    'Escribe con naturalidad y precisión en castellano de España. Prefiere verbos concretos y detalles significativos a adjetivos acumulados, clichés o prosa ornamental.',
    'Diferencia las voces por intención, ritmo, vocabulario y subtexto. El diálogo debe actuar sobre la escena, no repetir la narración.',
    'Mantén causalidad, continuidad espacial y corporal, conocimiento de cada personaje y consecuencias de lo ocurrido.',
    'Dramatiza los momentos importantes con acción, percepción y diálogo; resume solo el tejido conectivo que no merece un beat propio.',
    'No copies frases, escenas ni voces reconocibles de obras o fuentes externas.'
  ]
}

export const ADULT_SCENE_CRAFT: NarrativeRag = {
  id: 'adult-scene-craft-es',
  instructions: [
    'Trata el deseo como parte de personajes con motivos, límites, contradicciones y placer propio; nadie es un accesorio de la escena.',
    'Ajusta la explicitud al tono y al momento. Erótico y pornográfico son registros posibles, no niveles de calidad literaria.',
    'Construye progresión legible entre anticipación, señales recíprocas, escalada, variación y consecuencia; no comprimas todo el encuentro en una sola respuesta.',
    'Selecciona sensaciones concretas de cuerpo, respiración, temperatura, sonido, olor, ritmo y emoción; no conviertas cada párrafo en un inventario de los cinco sentidos.',
    'Nombra la anatomía con vocabulario natural y consistente con el registro. Evita eufemismos absurdos, sinónimos rotatorios, lenguaje clínico involuntario y grosería automática.',
    'Conserva coherencia física y plausibilidad: posiciones, ropa, manos, distancias, objetos, cansancio, excitación y respuesta corporal deben evolucionar de forma consistente.',
    'La escena debe tener significado y después: puede alterar intimidad, poder, confianza, conflicto, conocimiento o expectativas.',
    'La fantasía puede explorar deseos, tabúes y transgresión social sin sermones ni juicios del narrador; siguen mandando los límites autorizados de la sesión.'
  ]
}

export const ANTI_PATTERNS: NarrativeRag = {
  id: 'anti-patterns-es',
  instructions: [
    'Evita escalada automática por sesgo sexual, excitación instantánea sin contexto, orgasmos inagotables, anatomía imposible y secuencias mecánicas de acciones.',
    'Evita que todos los personajes hablen igual, expliquen lo que ya sienten, acepten todo sin reacción o revelen el conflicto antes de tiempo.',
    'Evita clichés de dominación, pureza, género, orientación, cuerpo o trauma salvo que la caracterización concreta los examine con intención narrativa.',
    'No confundas intensidad con mayúsculas, exclamaciones, hipérboles constantes, acumulación de adjetivos o repetición del mismo vocabulario explícito.'
  ]
}

export const FORMAT_RAGS: Record<'chat' | 'story' | 'visual_novel', NarrativeRag> = {
  chat: {
    id: 'format-chat-rp-self-insert-es',
    instructions: [
      'Es roleplay self-insert: el narrador se dirige a la persona jugadora como «tú» y los personajes le hablan directamente.',
      'El input del jugador expresa su agencia en primera persona, pero nunca escribas sus réplicas, decisiones, pensamientos voluntarios ni nuevas acciones por él.',
      'Prioriza intercambio, reacción inmediata y subtexto. Usa narración breve solo para gestos, entorno y consecuencias perceptibles.',
      'Responde a un único movimiento conversacional o físico y deja aire para la siguiente intervención; no cierres conflictos ni encuentros completos.'
    ]
  },
  story: {
    id: 'format-story-es',
    instructions: [
      'Construye relato continuo con la mayor proporción de prosa de los tres formatos, pero incluye diálogo frecuente que haga avanzar trama y relación.',
      'Combina escena, interioridad permitida, descripción selectiva y transición. No sustituyas acontecimientos importantes por resúmenes.',
      'Cada entrega debe sentirse como un fragmento literario completo y enlazar con la anterior sin recapitularla.',
      'Anticipa arcos futuros mediante causalidad, promesas y consecuencias, pero permite que el plan mutable cambie por las interacciones aceptadas.'
    ]
  },
  visual_novel: {
    id: 'format-visual-novel-es',
    instructions: [
      'Escribe como una visual novel: diálogo dominante, líneas ágiles, voces muy diferenciadas y acotaciones escénicas breves.',
      'No describas extensamente lo que ya muestra un fondo o sprite; narra cambios, atención, gesto, sonido y aquello que la imagen no puede comunicar.',
      'Usa uno o pocos beats visuales claros por respuesta. Los cambios de pose, expresión o ropa deben corresponder a assets autorizados.',
      'Mantén legibilidad en caja de diálogo: evita párrafos largos, monólogos expositivos y narración de novela convencional fragmentada artificialmente.',
      'Cuando corresponda intervenir, las opciones deben expresar intenciones realmente distintas; la opción abierta sigue siendo válida.'
    ]
  }
}

export const PERSPECTIVE_RAGS: Record<
  'self_insert' | 'first_person' | 'third_person' | 'narrative',
  NarrativeRag
> = {
  self_insert: {
    id: 'perspective-self-insert-es',
    instructions: [
      'La cámara permanece junto a la persona jugadora y usa segunda persona para lo que percibe o para consecuencias involuntarias.',
      'No atribuyas al jugador deseo, consentimiento, emoción, opinión, palabras o acciones que no estén en su input aceptado.'
    ]
  },
  first_person: {
    id: 'perspective-first-person-interactive-es',
    instructions: [
      'Narra desde el «yo» del protagonista controlado por la persona jugadora, con conocimiento limitado a lo que puede percibir o recordar.',
      'Puedes desarrollar sensaciones involuntarias y consecuencias de su input aceptado, pero no inventar su intención, juicio, diálogo ni próxima decisión.'
    ]
  },
  third_person: {
    id: 'perspective-third-person-interactive-es',
    instructions: [
      'Narra al protagonista controlado en tercera persona con focalización consistente y sin omnisciencia accidental.',
      'Describe consecuencias del input aceptado, pero deja sus decisiones, palabras y pensamientos voluntarios a la persona jugadora.'
    ]
  },
  narrative: {
    id: 'perspective-third-person-autonomous-es',
    instructions: [
      'Es narración pura, autónoma y no interactiva en tercera persona; no te dirijas a la persona lectora ni ofrezcas decisiones.',
      'Puedes decidir acciones, palabras y pensamientos de todos los personajes conforme a su caracterización, al estado y al plan mutable.',
      'Mantén una focalización clara por escena y cambia de punto de vista solo en una transición inequívoca.'
    ]
  }
}

export const TONE_RAGS: Record<'neutral' | 'romantic' | 'hardcore' | 'dark', NarrativeRag> = {
  neutral: {
    id: 'tone-neutral-es',
    instructions: [
      'Equilibra sensualidad y explicitud con vocabulario claro, contemporáneo y no afectado.',
      'Deja que la situación determine si una frase sugiere o muestra; evita tanto el pudor eufemístico como la crudeza gratuita.'
    ]
  },
  romantic: {
    id: 'tone-romantic-erotic-es',
    instructions: [
      'Da prioridad a anticipación, intimidad, vulnerabilidad, atención mutua y significado emocional sin convertir cada escena en sentimentalismo.',
      'Usa un registro sensual y evocador, con metáforas escasas y precisas; no ocultes la acción detrás de abstracciones.'
    ]
  },
  hardcore: {
    id: 'tone-hardcore-explicit-es',
    instructions: [
      'Muestra con claridad la acción física relevante y usa vocabulario sexual directo cuando la escena lo requiere.',
      'La explicitud no autoriza prosa burda, degradación automática, repetición anatómica ni pérdida de personaje, consentimiento, ritmo o consecuencias.'
    ]
  },
  dark: {
    id: 'tone-dark-es',
    instructions: [
      'Prioriza atmósfera, riesgo, poder y tensión psicológica; el malestar debe tener causa en la escena.',
      'Lo oscuro no autoriza degradación automática ni saltarse consentimiento, caracterización o consecuencias.'
    ]
  }
}

export type NarrativeFormatKey = keyof typeof FORMAT_RAGS
export type PerspectiveKey = keyof typeof PERSPECTIVE_RAGS
export type ToneKey = keyof typeof TONE_RAGS

export function normalizeNarrativeFormat(format: string): NarrativeFormatKey {
  const value = format.trim().toLowerCase()
  if (value === 'chat' || value === 'rp') return 'chat'
  if (value === 'vn' || value === 'visual_novel' || value === 'novela') return 'visual_novel'
  return 'story'
}

export function normalizeTone(tone: string): ToneKey {
  const value = tone.trim().toLowerCase()
  if (value === 'romantic' || value === 'romántico' || value === 'romantico' || value === 'íntimo' || value === 'intimo') {
    return 'romantic'
  }
  if (
    value === 'hardcore' ||
    value === 'explicit' ||
    value === 'explícito' ||
    value === 'explicito'
  ) {
    return 'hardcore'
  }
  if (value === 'dark' || value === 'oscuro') return 'dark'
  return 'neutral'
}

export function normalizePerspective(perspective: string): PerspectiveKey {
  const value = perspective.trim().toLowerCase()
  if (value === 'narrative' || value === 'narrativa' || value === 'autonomous') return 'narrative'
  if (value === 'first' || value === 'primera' || value === 'first_person' || value === 'yo') {
    return 'first_person'
  }
  if (value === 'third' || value === 'tercera' || value === 'third_person') return 'third_person'
  return 'self_insert'
}

export function normalizeInteractionPolicy(policy: string): string {
  const value = policy.trim().toLowerCase()
  if (value === 'lite' || value === 'lite_choices') return 'lite_choices'
  if (value === 'automatic' || value === 'automatic_checkpoints' || value === 'auto') {
    return 'automatic_checkpoints'
  }
  if (value === 'non_interactive' || value === 'no_interactivo') return 'non_interactive'
  return 'pause'
}

export function resolveEffectivePerspective(params: {
  format: string
  perspective: string
  interactionPolicy: string
}): PerspectiveKey {
  if (normalizeNarrativeFormat(params.format) === 'chat') return 'self_insert'
  const policy = normalizeInteractionPolicy(params.interactionPolicy)
  const perspective = normalizePerspective(params.perspective)
  if (policy === 'non_interactive' || perspective === 'narrative') return 'narrative'
  return perspective
}

export function selectNarrativeRags(params: {
  format: string
  perspective: string
  tone: string
  interactionPolicy: string
}): NarrativeRag[] {
  const formatKey = normalizeNarrativeFormat(params.format)
  const perspectiveKey = resolveEffectivePerspective(params)
  const toneKey = normalizeTone(params.tone)
  return [
    COMMON_LITERARY,
    ADULT_SCENE_CRAFT,
    ANTI_PATTERNS,
    FORMAT_RAGS[formatKey],
    PERSPECTIVE_RAGS[perspectiveKey],
    TONE_RAGS[toneKey]
  ]
}

export function renderNarrativeRags(rags: readonly NarrativeRag[]): string {
  return rags
    .map(
      (rag) => `[${rag.id}]\n` + rag.instructions.map((instruction) => `- ${instruction}`).join('\n')
    )
    .join('\n')
}

export function narrativeRagVersionMap(params: {
  format: string
  perspective: string
  tone: string
  interactionPolicy: string
}): Record<string, string> {
  const map: Record<string, string> = { 'narrative-rag': RAG_VERSION }
  for (const rag of selectNarrativeRags(params)) {
    map[rag.id] = RAG_VERSION
  }
  return map
}
