export type CreatorFormat = 'story' | 'chat' | 'vn'
export type GenerationProfile = 'quick' | 'quality'
export type NarrativeTone = 'neutral' | 'romantic' | 'hardcore' | 'dark'
export type NarrativePerspective = 'first' | 'second' | 'third' | 'narrative'
export type StoryDuration = 'encounter' | 'short' | 'medium' | 'long' | 'open'
export type InteractionPolicy = 'pause' | 'lite' | 'automatic' | 'non_interactive'
export type CreationSource = 'blank' | 'experience' | 'style_reference' | 'taste' | 'quick_preset'

export type StoryConfiguration = {
  format: CreatorFormat
  profile: GenerationProfile
  tone: NarrativeTone
  perspective: NarrativePerspective
  duration: StoryDuration
  interactionPolicy: InteractionPolicy
}

export type ChoiceDefinition<T extends string> = {
  value: T
  label: string
  description: string
}

export const MIN_TASTE_RATINGS = 3

export const FORMAT_CHOICES: ChoiceDefinition<CreatorFormat>[] = [
  {
    value: 'chat',
    label: 'Roleplay',
    description:
      'Conversación rápida y self-insert: los personajes te hablan y tú conservas cada decisión.'
  },
  {
    value: 'vn',
    label: 'Visual novel',
    description: 'Diálogo, sprites, fondos y elecciones en una puesta en escena panorámica.'
  },
  {
    value: 'story',
    label: 'Story',
    description:
      'Más prosa e interioridad, con diálogo frecuente y espacio para desarrollar arcos largos.'
  }
]

export const PROFILE_CHOICES: ChoiceDefinition<GenerationProfile>[] = [
  {
    value: 'quick',
    label: 'Rápido',
    description: 'Menor latencia y planificación breve; ideal para chat y encuentros ágiles.'
  },
  {
    value: 'quality',
    label: 'Calidad',
    description:
      'Planifica, escribe, revisa y valida cada beat; tarda más y cuida mejor la continuidad.'
  }
]

export const TONE_CHOICES: ChoiceDefinition<NarrativeTone>[] = [
  {
    value: 'neutral',
    label: 'Equilibrado',
    description: 'Castellano directo entre lo sensual y lo explícito, según el momento.'
  },
  {
    value: 'romantic',
    label: 'Romántico',
    description: 'Más anticipación, intimidad y significado emocional sin ocultar la acción.'
  },
  {
    value: 'hardcore',
    label: 'Hardcore',
    description:
      'Vocabulario más explícito y físico, manteniendo ritmo, personaje y calidad literaria.'
  },
  {
    value: 'dark',
    label: 'Oscuro',
    description: 'Atmósfera, riesgo y tensión psicológica; el malestar debe tener causa en la escena.'
  }
]

export const PERSPECTIVE_CHOICES: ChoiceDefinition<NarrativePerspective>[] = [
  {
    value: 'first',
    label: 'Primera persona',
    description: 'Vives la historia desde el protagonista («yo»).'
  },
  {
    value: 'second',
    label: 'Segunda persona',
    description: 'El narrador te habla como «tú»; típico del roleplay self-insert.'
  },
  {
    value: 'third',
    label: 'Tercera persona',
    description: 'Sigues al protagonista desde fuera, pero sus decisiones siguen siendo tuyas.'
  },
  {
    value: 'narrative',
    label: 'Narrativa',
    description: 'Tercera persona pura y autónoma: lectura continua sin elecciones.'
  }
]

export const DURATION_CHOICES: ChoiceDefinition<StoryDuration>[] = [
  {
    value: 'encounter',
    label: 'Encuentro',
    description: '12–20 beats: contexto breve, escalada rápida y cierre compacto.'
  },
  {
    value: 'short',
    label: 'Corta',
    description: '30–60 beats: conflicto compacto, diálogo y consecuencias.'
  },
  {
    value: 'medium',
    label: 'Media',
    description: '80–160 beats: varios movimientos de relación, tensión y resolución.'
  },
  {
    value: 'long',
    label: 'Larga',
    description: '180–350 beats: arcos sostenidos y memoria duradera.'
  },
  {
    value: 'open',
    label: 'Abierta',
    description: 'Sin objetivo fijo: continúa mientras quieras seguir.'
  }
]

export const INTERACTION_CHOICES: ChoiceDefinition<InteractionPolicy>[] = [
  {
    value: 'pause',
    label: 'Cada paso',
    description: 'Se detiene tras cada beat para que hables, actúes o dejes elegir a la IA.'
  },
  {
    value: 'lite',
    label: 'Opciones rápidas',
    description: 'Propone respuestas contextuales y conserva siempre el input abierto.'
  },
  {
    value: 'automatic',
    label: 'Automático',
    description: 'Avanza solo y se detiene ante decisiones realmente importantes.'
  },
  {
    value: 'non_interactive',
    label: 'Solo lectura',
    description: 'El motor conduce al reparto y no ofrece elecciones.'
  }
]

export const FORMAT_DEFAULTS: Record<CreatorFormat, StoryConfiguration> = {
  chat: {
    format: 'chat',
    profile: 'quick',
    tone: 'neutral',
    perspective: 'first',
    duration: 'short',
    interactionPolicy: 'pause'
  },
  vn: {
    format: 'vn',
    profile: 'quality',
    tone: 'romantic',
    perspective: 'first',
    duration: 'medium',
    interactionPolicy: 'lite'
  },
  story: {
    format: 'story',
    profile: 'quality',
    tone: 'neutral',
    perspective: 'third',
    duration: 'medium',
    interactionPolicy: 'pause'
  }
}

export const QUICK_PRESETS: Array<{
  id: string
  title: string
  description: string
  accent: string
  config: StoryConfiguration
  premise: string
}> = [
  {
    id: 'hard-fast-rp',
    title: 'Dura y rápida',
    description: 'Roleplay explícito, respuesta ágil y encuentro compacto.',
    accent: 'coral',
    premise: 'Un encuentro inmediato, tensión alta y poco margen para dudar.',
    config: {
      format: 'chat',
      profile: 'quick',
      tone: 'hardcore',
      perspective: 'first',
      duration: 'encounter',
      interactionPolicy: 'pause'
    }
  },
  {
    id: 'slow-narrative',
    title: 'Slow burn narrativo',
    description: 'Lectura autónoma, romántica y larga, con tensión antes de la resolución.',
    accent: 'gold',
    premise: 'Una relación que se construye despacio, con subtexto y consecuencias.',
    config: {
      format: 'story',
      profile: 'quality',
      tone: 'romantic',
      perspective: 'narrative',
      duration: 'long',
      interactionPolicy: 'non_interactive'
    }
  },
  {
    id: 'cinematic-vn',
    title: 'Visual novel intensa',
    description: 'Escena visual, decisiones ágiles y ritmo de temporada corta.',
    accent: 'azure',
    premise: 'Una noche decisiva: diálogos cargados y elecciones que marcan el rumbo.',
    config: {
      format: 'vn',
      profile: 'quality',
      tone: 'neutral',
      perspective: 'first',
      duration: 'short',
      interactionPolicy: 'lite'
    }
  },
  {
    id: 'progressive-rp',
    title: 'Roleplay progresivo',
    description: 'Chat de calidad con más construcción, memoria y espacio para cambiar el rumbo.',
    accent: 'soft',
    premise: 'Una conversación que se profundiza; el deseo aparece cuando hay terreno ganado.',
    config: {
      format: 'chat',
      profile: 'quality',
      tone: 'romantic',
      perspective: 'first',
      duration: 'medium',
      interactionPolicy: 'pause'
    }
  }
]

export const DEFAULT_INTEREST_TERMS = [
  { id: 'romance', label: 'Romance', facet: 'tono' },
  { id: 'slow-burn', label: 'Slow burn', facet: 'ritmo' },
  { id: 'tension', label: 'Tensión', facet: 'ritmo' },
  { id: 'dialogo', label: 'Diálogo íntimo', facet: 'estilo' },
  { id: 'proximidad', label: 'Proximidad', facet: 'interés' },
  { id: 'poder', label: 'Juego de poder', facet: 'dinámica' },
  { id: 'vulnerabilidad', label: 'Vulnerabilidad', facet: 'tono' },
  { id: 'humor', label: 'Humor seco', facet: 'tono' }
]

export function configurationForFormat(format: CreatorFormat): StoryConfiguration {
  return { ...FORMAT_DEFAULTS[format] }
}

export function coherentConfiguration(config: StoryConfiguration): StoryConfiguration {
  if (config.format === 'chat') {
    return {
      ...config,
      perspective:
        config.perspective === 'narrative' || config.perspective === 'third'
          ? 'first'
          : config.perspective || 'first',
      interactionPolicy:
        config.interactionPolicy === 'non_interactive' ? 'automatic' : config.interactionPolicy
    }
  }
  if (config.perspective === 'narrative' || config.interactionPolicy === 'non_interactive') {
    return { ...config, perspective: 'narrative', interactionPolicy: 'non_interactive' }
  }
  return config
}

export function mapToneToSession(tone: NarrativeTone) {
  if (tone === 'romantic') return 'romantic'
  if (tone === 'hardcore') return 'explicit'
  if (tone === 'dark') return 'dark'
  return 'sensual'
}

export function mapPerspectiveToSession(perspective: NarrativePerspective) {
  if (perspective === 'first') return 'first'
  if (perspective === 'third') return 'third'
  if (perspective === 'narrative') return 'narrative'
  return 'second'
}
