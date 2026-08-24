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
  signal?: AbortSignal
}) {
  let response: Response
  try {
    response = await fetch('/api/swarm/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: input.prompt,
        ...(input.preset ? { preset: input.preset } : { model: input.model })
      }),
      signal: input.signal
    })
  } catch (caught) {
    if ((caught as Error).name === 'AbortError') throw caught
    throw new Error('No se pudo conectar con el proxy de SwarmUI.', { cause: caught })
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as {
      message?: string
      statusMessage?: string
    } | null
    throw new Error(payload?.message || payload?.statusMessage || `SwarmUI respondió ${response.status}.`)
  }
  return response.blob()
}
