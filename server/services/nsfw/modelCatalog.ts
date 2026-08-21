import type { NarrativeModelAvailability, NarrativeModelConfig } from '../../shared/types/nsfw/model.ts'

const DEFAULT_MODELS: NarrativeModelConfig[] = [
  {
    alias: 'Gemma 4 · StyleTune V2',
    lmStudioModelId: 'gemma-4-26b-a4b-heretic-styletune-v2-head-i1',
    enabled: true,
    contextBudget: 8192,
    quickDefaults: { temperature: 0.9, topP: 0.95, maxTokens: 2048 },
    qualityDefaults: { temperature: 0.75, topP: 0.9, maxTokens: 3072 }
  },
  {
    alias: 'Gemma 4 · StyleTune 31B',
    lmStudioModelId: 'gemma-4-31b-styletune-heretic-ara-i1',
    enabled: true,
    contextBudget: 8192,
    quickDefaults: { temperature: 0.9, topP: 0.95, maxTokens: 2048 },
    qualityDefaults: { temperature: 0.75, topP: 0.9, maxTokens: 3072 }
  },
  {
    alias: 'G4 · Moonlight Dusk',
    lmStudioModelId: 'g4-moonlight-dusk-26b-a4b-heretic-i1',
    enabled: true,
    contextBudget: 8192,
    quickDefaults: { temperature: 0.9, topP: 0.95, maxTokens: 2048 },
    qualityDefaults: { temperature: 0.75, topP: 0.9, maxTokens: 3072 }
  }
]

function normalizeModelId(value: string) {
  return value.trim().toLocaleLowerCase()
}

function idsMatch(catalogId: string, availableId: string) {
  const a = normalizeModelId(catalogId)
  const b = normalizeModelId(availableId)
  return a === b || a.includes(b) || b.includes(a)
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
    const available = [...availableIds].some((id) => idsMatch(model.lmStudioModelId, id))
    return {
      ...model,
      available: available || availableIds.size === 0,
      unavailableReason:
        available || availableIds.size === 0 ? null : 'Modelo no disponible en LM Studio'
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
  const catalog = listNarrativeModelCatalog()
  const needle = normalizeModelId(alias)
  if (!needle) return null
  const exact =
    catalog.find((model) => normalizeModelId(model.alias) === needle) ||
    catalog.find((model) => normalizeModelId(model.lmStudioModelId) === needle)
  if (exact) return exact
  // Solo fuzzy si hay un único candidato (evita caer siempre en el primero del catálogo).
  const fuzzy = catalog.filter((model) => {
    const id = normalizeModelId(model.lmStudioModelId)
    return id.includes(needle) || needle.includes(id)
  })
  return fuzzy.length === 1 ? fuzzy[0]! : null
}
