import { narrativeRagVersionMap } from './narrativeRag.ts'

export interface SkillDefinition {
  id: string
  version: string
  purpose: string
  formats: Array<'story' | 'chat' | 'vn' | '*'>
  text: string
}

export const NSFW_SKILLS: SkillDefinition[] = [
  {
    id: 'voz-espana',
    version: '1.0.0',
    purpose: 'Castellano de España directo',
    formats: ['*'],
    text: 'Usa castellano de España: tú, vosotros si encaja, léxico natural, sin latinismos forzados.'
  },
  {
    id: 'dialogo-subtexto',
    version: '1.0.0',
    purpose: 'Diálogo con subtexto',
    formats: ['*'],
    text: 'El diálogo revela deseo e intención sin monólogos de exposición. Subtexto sobre explicación.'
  },
  {
    id: 'escena-causalidad',
    version: '1.0.0',
    purpose: 'Causalidad de escena',
    formats: ['*'],
    text: 'Cada beat avanza causa→efecto. Nada aparece solo porque “queda bien”.'
  },
  {
    id: 'personaje-relacion',
    version: '1.0.0',
    purpose: 'Personaje y relación',
    formats: ['*'],
    text: 'Conserva personalidad y poder relativo. No usurpes al protagonista.'
  },
  {
    id: 'pacing',
    version: '1.0.0',
    purpose: 'Ritmo',
    formats: ['*'],
    text: 'Una unidad de escena por envelope. Para en decisión o pausa natural.'
  },
  {
    id: 'sensualidad',
    version: '1.0.0',
    purpose: 'Sensualidad',
    formats: ['*'],
    text: 'Sensualidad concreta y sensorial; evita eufemismos vacíos y porno genérico.'
  },
  {
    id: 'explicitud',
    version: '1.0.0',
    purpose: 'Explicitud calibrada',
    formats: ['*'],
    text: 'La explicitud sigue intereses/exclusiones. Nunca fuerces exclusiones.'
  },
  {
    id: 'continuidad',
    version: '1.0.0',
    purpose: 'Continuidad',
    formats: ['*'],
    text: 'Respeta Bible, World State y presentes. No contradigas hechos canónicos.'
  },
  {
    id: 'agencia',
    version: '1.0.0',
    purpose: 'Agencia del jugador',
    formats: ['*'],
    text: 'El input del jugador importa. No anules Speak/Act ni adelantes el desenlace.'
  },
  {
    id: 'anticliche',
    version: '1.0.0',
    purpose: 'Anticliché',
    formats: ['*'],
    text: 'Evita plantillas vacías, “labios entreabiertos” por defecto y arquetipos planos.'
  },
  {
    id: 'contrato-story',
    version: '1.0.0',
    purpose: 'Contrato Story',
    formats: ['story'],
    text: 'Prosa serif, 200–600 palabras orientativas, diálogo sustancial, sin burbujas.'
  },
  {
    id: 'contrato-chat',
    version: '1.0.0',
    purpose: 'Contrato Chat',
    formats: ['chat'],
    text: 'Beats cortos 40–150 palabras, narración breve, diálogo con actorId válido.'
  },
  {
    id: 'contrato-vn',
    version: '1.0.0',
    purpose: 'Contrato VN',
    formats: ['vn'],
    text: 'Unidades cortas, choices claras, stop en decisión. visualCues para fondos/sprites.'
  },
  {
    id: 'speech',
    version: '1.0.0',
    purpose: 'Speech annotations',
    formats: ['*'],
    text: 'speech es opcional, persistido y oculto al lector. No es audio real.'
  },
  {
    id: 'final-secuela',
    version: '1.0.0',
    purpose: 'Final y secuela',
    formats: ['*'],
    text: 'Si cierras, deja Characterizations útiles para una posible secuela.'
  }
]

export function resolveSkillsForFormat(format: 'story' | 'chat' | 'vn') {
  return NSFW_SKILLS.filter(
    (skill) => skill.formats.includes('*') || skill.formats.includes(format)
  )
}

export function skillVersionMap(
  format: 'story' | 'chat' | 'vn',
  session?: {
    tone: string
    perspective: string
    interactionPolicy: string
  }
) {
  const map: Record<string, string> = {}
  for (const skill of resolveSkillsForFormat(format)) {
    map[skill.id] = skill.version
  }
  Object.assign(
    map,
    narrativeRagVersionMap({
      format,
      perspective: session?.perspective || 'second',
      tone: session?.tone || 'sensual',
      interactionPolicy: session?.interactionPolicy || 'pause'
    })
  )
  return map
}

export function skillsPromptBlock(format: 'story' | 'chat' | 'vn') {
  return resolveSkillsForFormat(format)
    .map((skill) => `- [${skill.id}@${skill.version}] ${skill.text}`)
    .join('\n')
}
