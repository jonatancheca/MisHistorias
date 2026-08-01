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

export interface Background {
  id: string
  /** Etiqueta única que el modelo usa en `Fondo [etiqueta]:` */
  tag: string
  description: string
  mimeType: string
  createdAt: number
}

export interface Story {
  id: string
  title: string
  premise: string
  /** Preferencias del protagonista especificas de esta historia */
  protagonistPreferences: string
  /** Anade las preferencias globales o las reemplaza para esta historia */
  protagonistPreferencesMode: ProtagonistPreferencesMode
  characterIds: string[]
  /** Fondo inicial; null permite que el modelo decida */
  initialBackgroundId: string | null
  presetId: string | null
  createdAt: number
  updatedAt: number
}

export type MessageRole = 'user' | 'assistant'

export type Theme = 'system' | 'light' | 'dark'
export type ResponseSpeed = 'slow' | 'medium' | 'high' | 'instant'
export type ProtagonistPreferencesMode = 'append' | 'replace'

export type SegmentType = 'dialogue' | 'narration' | 'background'

export interface MessageSegment {
  type: SegmentType
  /** id del personaje que habla, null si es narración */
  characterId: string | null
  /** Fondo resuelto al parsear; null si la etiqueta no existe */
  backgroundId?: string | null
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
  /** Prompt activo de la colección privada; el resto de ajustes se comparte. */
  privateActivePresetId: string | null
  /** Versión aplicada del prompt por defecto en cada colección. */
  defaultPresetVersion: number
  privateDefaultPresetVersion: number
  theme: Theme
  /** Velocidad de revelado visual de las respuestas del asistente */
  responseSpeed: ResponseSpeed
  /** Modo prueba: responde texto aleatorio sin llamar al LLM */
  mockMode: boolean
  /** Nombre con el que aparece el protagonista en la historia */
  userName: string
  /** Color hex del protagonista en la historia */
  userColor: string
  /** Preferencias globales del protagonista inyectadas en el prompt */
  protagonistPreferences: string
}

export interface LlmModel {
  id: string
}
