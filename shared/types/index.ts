export interface CharacterImage {
  id: string
  characterId: string
  /** Etiquetas cortas que el modelo usa en el prefijo, ej. `feliz` */
  tags: string[]
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
  /** Etiquetas descriptivas, independientes de las etiquetas de imagen */
  tags: string[]
  /** Color hex usado para su nombre y diálogo en la historia */
  color: string
  createdAt: number
  updatedAt: number
}

export interface StoryImageCatalogEntry {
  imageId: string
  characterId: string
  characterName: string
  tags: string[]
  description: string
  isDefault: boolean
}

export interface Background {
  id: string
  /** Etiquetas únicas que el modelo usa en `Fondo [etiqueta]:` */
  tags: string[]
  description: string
  mimeType: string
  createdAt: number
}

export interface StoryCharacterCustomization {
  characterId: string
  /** Copia independiente del prompt global para esta historia. */
  prompt: string
  /** Copia independiente de etiquetas descriptivas; nunca incluye etiquetas de imagen. */
  tags: string[]
}

export interface Story {
  id: string
  title: string
  premise: string
  /** Vista alternativa con fondo, personajes superpuestos y diálogo inferior. */
  visualMode: boolean
  /** Preferencias del protagonista especificas de esta historia */
  protagonistPreferences: string
  /** Anade las preferencias globales o las reemplaza para esta historia */
  protagonistPreferencesMode: ProtagonistPreferencesMode
  characterIds: string[]
  /** Prompt y etiquetas descriptivas fijados al crear la historia. */
  characterCustomizations: StoryCharacterCustomization[]
  /** Fondo inicial; null permite que el modelo decida */
  initialBackgroundId: string | null
  presetId: string | null
  /** Catálogo de imágenes comunicado en la última llamada válida al modelo. */
  imageCatalogSnapshot?: StoryImageCatalogEntry[]
  createdAt: number
  updatedAt: number
}

export type MessageRole = 'user' | 'assistant'

export type Theme = 'system' | 'light' | 'dark'
export type ResponseSpeed = 'slow' | 'medium' | 'high' | 'instant'
export type ProtagonistPreferencesMode = 'append' | 'replace'
export type GenerationMode = 'normal' | 'continue' | 'auto'

export type SegmentType = 'dialogue' | 'protagonist-dialogue' | 'narration' | 'background'

export interface MessageSegment {
  type: SegmentType
  /** id del personaje que habla, null si es narración */
  characterId: string | null
  /** Fondo resuelto al parsear; null si la etiqueta no existe */
  backgroundId?: string | null
  /** etiqueta emitida por el modelo (puede no existir entre las imágenes) */
  tag: string | null
  /** Etiquetas visuales emitidas para un diálogo, en orden y sin duplicados. */
  tags?: string[]
  /** Imagen de personaje elegida para este segmento; queda estable al recargar. */
  imageId?: string | null
  text: string
}

export interface Message {
  id: string
  storyId: string
  role: MessageRole
  /** Texto crudo tal cual lo escribió el usuario o devolvió el modelo */
  raw: string
  segments: MessageSegment[]
  /** Modo que originó una respuesta del asistente; permite regenerarla con las mismas reglas. */
  generationMode?: GenerationMode
  createdAt: number
}

export interface LlmDebugRequest {
  model: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  temperature: number
  max_tokens: number
  stream: false
}

export type LlmDebugResponse =
  | {
      content: string
      finishReason: string | null
    }
  | {
      error: string
      status?: number
      detail?: string
    }

export interface LlmDebugTrace {
  id: string
  storyId: string
  requestMessageId?: string
  responseMessageId?: string
  status: 'success' | 'error'
  request: LlmDebugRequest
  response: LlmDebugResponse
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
  /** Token opcional de LM Studio. Solo se mantiene en memoria mientras se edita. */
  apiKey: string
  /** El servidor tiene un token guardado; nunca devuelve su valor. */
  apiKeyConfigured: boolean
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
  /** En novela visual, espera una acción antes de mostrar el siguiente texto. */
  visualNovelManualAdvance: boolean
  /** Modo prueba: responde texto aleatorio sin llamar al LLM */
  mockMode: boolean
  /** Nombre con el que aparece el protagonista en la historia */
  userName: string
  /** Nombre exclusivo del ámbito privado; null hereda userName */
  privateUserName: string | null
  /** Color hex del protagonista en la historia */
  userColor: string
  /** Preferencias globales del protagonista inyectadas en el prompt */
  protagonistPreferences: string
  /** Preferencias exclusivas del ámbito privado; null hereda las globales normales */
  privateProtagonistPreferences: string | null
}

export type DatabaseBackupKind = 'manual' | 'migration' | 'before-restore'

export interface DatabaseBackup {
  name: string
  kind: DatabaseBackupKind
  createdAt: string
  size: number
  schemaVersion: number | null
  valid: boolean
}

export interface LlmModel {
  id: string
}
