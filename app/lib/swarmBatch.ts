import type { ImageGenerationMetadata } from '../../shared/types/index.ts'
import { sanitizeTags } from './tags.ts'

export interface SwarmBatchJob {
  prompt: string
  tags: string[]
  generation: ImageGenerationMetadata
}

export function joinSwarmPrompts(base: string, extra: string) {
  return [base.trim().replace(/[,\s]+$/, ''), extra.trim().replace(/^[,\s]+/, '')]
    .filter(Boolean).join(', ')
}

export function createSwarmBatch(input: {
  count: number
  seed: string
  prefix: string
  prompt: string
  tags: string[]
  prompts?: Array<{ prompt: string; tags: string[] }>
}, randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!) {
  if (!Number.isSafeInteger(input.count) || input.count < 1) {
    throw new Error('El número de imágenes debe ser un entero positivo.')
  }
  if (!input.prompt.trim() && !input.prefix.trim()) throw new Error('Indica un prompt de imagen o un prefijo.')
  const seed = input.seed.trim() ? Number(input.seed.trim()) : randomSeed()
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('La semilla debe ser un entero no negativo.')
  const prompts = input.prompts?.map((item) => ({ ...item, tags: [...item.tags] })) ?? [{ prompt: '', tags: [] }]
  if (!prompts.length) throw new Error('Crea al menos un prompt SwarmUI.')
  const total = input.count * prompts.length
  if (!Number.isSafeInteger(total)) throw new Error('El conjunto tiene demasiadas imágenes.')
  const variations = new Map<number, number>()
  const usedSeeds = new Set([seed])
  const baseTags = [...input.tags]
  // Las variantes se fijan al usarlas por primera vez, sin reservar memoria para todo el lote.
  function *jobs(): Generator<SwarmBatchJob> {
    for (const predefined of prompts) {
      const prompt = [input.prefix.trim(), predefined.prompt ? joinSwarmPrompts(input.prompt, predefined.prompt) : input.prompt.trim()]
        .filter(Boolean).join('\n')
      for (let index = 0; index < input.count; index++) {
        if (index > 0 && !variations.has(index)) {
          let variation = randomSeed()
          while (usedSeeds.has(variation)) variation = (variation + 1) >>> 0
          usedSeeds.add(variation)
          variations.set(index, variation)
        }
        yield {
          prompt,
          tags: sanitizeTags([...baseTags, ...predefined.tags]),
          generation: { seed, ...(index > 0 ? { variationSeed: variations.get(index)!, variationSeedStrength: 0.5 } : {}) }
        }
      }
    }
  }
  return { total, jobs: jobs() }
}

export async function runSwarmBatch<T>(input: {
  jobs: Iterable<SwarmBatchJob>
  signal: AbortSignal
  generate: (job: SwarmBatchJob) => Promise<T>
  save: (image: T, job: SwarmBatchJob) => Promise<unknown>
  progress: (completed: number) => void
}) {
  let completed = 0
  for (const job of input.jobs) {
    input.signal.throwIfAborted()
    const image = await input.generate(job)
    input.signal.throwIfAborted()
    await input.save(image, job)
    input.progress(++completed)
  }
}
