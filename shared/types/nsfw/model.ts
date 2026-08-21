export interface SamplingConfig {
  temperature: number
  topP: number
  maxTokens: number
}

export interface NarrativeModelConfig {
  alias: string
  lmStudioModelId: string
  enabled: boolean
  quickDefaults: SamplingConfig
  qualityDefaults: SamplingConfig
  contextBudget: number
}

export interface NarrativeModelAvailability extends NarrativeModelConfig {
  available: boolean
  unavailableReason: string | null
}
