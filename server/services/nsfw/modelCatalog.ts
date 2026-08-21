import type { NarrativeModelAvailability, NarrativeModelConfig } from '../../shared/types/nsfw/model.ts'

const DEFAULT_MODELS: NarrativeModelConfig[] = [
  {
    alias: 'Gemma-4-26B-A4B StyleTune V2 + Heretic',
    lmStudioModelId: 'gemma-4-26b-a4b-styletune-v2-heretic',
    enabled: true,
    contextBudget: 8192,
    quickDefaults: { temperature: 0.9, topP: 0.95, maxTokens: 512 },
    qualityDefaults: { temperature: 0.75, topP: 0.9, maxTokens: 1024 }
  },
  {
    alias: 'Gemma-4-31B StyleTune Heretic ARA',
    lmStudioModelId: 'gemma-4-31b-styletune-heretic-ara',
    enabled: true,
    contextBudget: 8192,
    quickDefaults: { temperature: 0.9, topP: 0.95, maxTokens: 512 },
    qualityDefaults: { temperature: 0.75, topP: 0.9, maxTokens: 1024 }
  },
  {
    alias: 'G4-Dark-Soul-26B-A4B',
    lmStudioModelId: 'g4-dark-soul-26b-a4b',
    enabled: true,
    contextBudget: 8192,
    quickDefaults: { temperature: 0.9, topP: 0.95, maxTokens: 512 },
    qualityDefaults: { temperature: 0.75, topP: 0.9, maxTokens: 1024 }
  }
]

function normalizeModelId(value: string) {
  return value.trim().toLocaleLowerCase()
}

export function listNarrativeModelCatalog(): NarrativeModelConfig[] {
  return DEFAULT_MODELS.map((model) => ({ ...model }))
}

export async function listAvailableNarrativeModels(
  lmStudioBaseUrl: string
): Promise<NarrativeModelAvailability[]> {
  const catalog = listNarrativeModelCatalog()
  const availableIds = await fetchLmStudioModelIds(lmStudioBaseUrl)
  return catalog.map((model) => {
    const available = availableIds.has(normalizeModelId(model.lmStudioModelId))
    return {
      ...model,
      available,
      unavailableReason: available ? null : 'Modelo no disponible en LM Studio'
    }
  })
}

async function fetchLmStudioModelIds(baseUrl: string) {
  const ids = new Set<string>()
  const trimmed = baseUrl.trim()
  if (!trimmed) return ids

  try {
    const response = await fetch(`${trimmed.replace(/\/$/, '')}/v1/models`, {
      signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) return ids
    const payload = (await response.json()) as { data?: Array<{ id?: string }> }
    for (const item of payload.data ?? []) {
      if (typeof item.id === 'string' && item.id.trim()) {
        ids.add(normalizeModelId(item.id))
      }
    }
  } catch {
    return ids
  }
  return ids
}

export function resolveModelByAlias(alias: string) {
  return listNarrativeModelCatalog().find((model) => model.alias === alias) ?? null
}
