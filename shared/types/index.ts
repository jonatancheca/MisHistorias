export interface CharacterImage {
  id: string
  characterId: string
  /** Etiqueta corta que el modelo usa en el prefijo, ej. `feliz` */
  tag: string
  description: string
  isDefault: boolean
  mimeType: string
  createdAt: number
}

export interface Character {
  id: string
  name: string
  /** Descripción / persona que se inyecta en el system prompt */
  prompt: string
  /** Color hex usado para su nombre y diálogo en la historia */
  color: string
  createdAt: number
  updatedAt: number
}

export interface Story {
  id: string
  title: string
  premise: string
  characterIds: string[]
  presetId: string | null
  createdAt: number
  updatedAt: number
}

export type MessageRole = 'user' | 'assistant'

export type SegmentType = 'dialogue' | 'narration'

export interface MessageSegment {
  type: SegmentType
  /** id del personaje que habla, null si es narración */
  characterId: string | null
  /** etiqueta emitida por el modelo (puede no existir entre las imágenes) */
  tag: string | null
  text: string
}

export interface Message {
  id: string
  storyId: string
  role: MessageRole
  /** Texto crudo tal cual lo escribió el usuario o devolvió el modelo */
  raw: string
  segments: MessageSegment[]
  createdAt: number
}

export interface PromptPreset {
  id: string
  name: string
  content: string
  createdAt: number
  updatedAt: number
}

export interface AppSettings {
  baseUrl: string
  /** Token opcional del servidor (LMStudio "API key"). Se guarda en el navegador. */
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  /** Presupuesto de caracteres del historial enviado al modelo */
  historyBudget: number
  activePresetId: string | null
  theme: 'light' | 'dark'
  /** Nombre con el que aparece el usuario en la historia */
  userName: string
  /** Color hex del usuario en la historia */
  userColor: string
}

export interface LlmModel {
  id: string
}
