import type { SwarmCallDiagnostic } from '../../shared/types/index.ts'
import { readSwarmDiagnostic, sanitizeSwarmDiagnostic } from '../../shared/utils/swarmError.ts'

export interface SwarmCallError extends Error {
  diagnostic: SwarmCallDiagnostic
}

export interface SwarmCatalog {
  version: string
  models: string[]
  loras: string[]
  presets: string[]
}

function errorMessage(caught: unknown, fallback: string) {
  const detail = caught as {
    data?: { message?: string; statusMessage?: string }
    statusMessage?: string
    message?: string
  }
  return detail.data?.message || detail.data?.statusMessage || detail.statusMessage ||
    detail.message || fallback
}

export async function fetchSwarmCatalog(signal?: AbortSignal) {
  try {
    return await $fetch<SwarmCatalog>('/api/swarm/catalog', { signal })
  } catch (caught) {
    throw new Error(errorMessage(caught, 'No se pudo conectar con SwarmUI.'), {
      cause: caught
    })
  }
}

export async function fetchSwarmImage(input: {
  prompt: string
  preset?: string
  model?: string
  lora?: string
  seed?: string
  variationSeed?: number
  variationSeedStrength?: number
  signal?: AbortSignal
}) {
  const body = {
    prompt: input.prompt,
    ...(input.preset ? { preset: input.preset } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.lora ? { lora: input.lora } : {}),
    ...(input.seed ? { seed: input.seed } : {}),
    ...(input.variationSeed !== undefined ? { variationSeed: input.variationSeed } : {}),
    ...(input.variationSeedStrength !== undefined ? { variationSeedStrength: input.variationSeedStrength } : {})
  }
  let response: Response | undefined
  let responseBody: unknown = null
  try {
    response = await fetch('/api/swarm/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: input.signal
    })
    if (response.ok) return await response.blob()
    const raw = await response.text()
    try { responseBody = JSON.parse(raw) } catch { responseBody = raw }
    const payload = responseBody as {
      message?: string; statusMessage?: string
      data?: { message?: string; diagnostic?: unknown }
    } | null
    const diagnostic = readSwarmDiagnostic(payload?.data?.diagnostic)
    const message = diagnostic?.message || payload?.data?.message || payload?.message ||
      payload?.statusMessage || `El proxy de SwarmUI respondió ${response.status}.`
    throw Object.assign(new Error(message), { diagnostic })
  } catch (caught) {
    if ((caught as Error).name === 'AbortError') throw caught
    const error = caught as Partial<SwarmCallError>
    const diagnostic = error.diagnostic ?? sanitizeSwarmDiagnostic({
      target: 'proxy', operation: '/api/swarm/generate', request: body,
      requestSent: response ? true : null,
      response: response ? { status: response.status, body: responseBody } : null,
      message: response ? error.message : 'No se pudo conectar con el proxy de SwarmUI.'
    }) as SwarmCallDiagnostic
    throw Object.assign(new Error(diagnostic.message, { cause: caught }), { diagnostic })
  }
}
