import type { Character, ImageGenerationMetadata } from '#shared/types'
import { createSwarmBatch, runSwarmBatch, type SwarmBatchJob } from './swarmBatch.ts'
import { fetchSwarmImage } from './swarm.ts'
import { sanitizeTags } from './tags.ts'

export interface StoryImageRequest {
  characterId: string
  characterName: string
  tags: string[]
  prompt: string
}

export interface StoryImageRequestParseResult {
  visibleRaw: string
  requests: StoryImageRequest[]
  warnings: string[]
}

export interface CharacterImageJob extends SwarmBatchJob {
  characterId: string
  characterName: string
}

export interface CharacterImageBatchInput {
  characterId: string
  characterName: string
  character: Character
  prompt: string
  tags: string[]
  count?: number
  prompts?: Array<{ prompt: string; tags: string[] }>
}

const IMAGE_DIRECTIVE_RE = /^\s*Imagen\s+([^:\n\]]{1,100}?)\s*((?:\s*\[[^\]\n]{1,80}\])+?)\s*:\s*(.*)$/i
const IMAGE_DIRECTIVE_PREFIX_RE = /^\s*Imagen\b/i

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('es')
}

function directiveTags(value: string) {
  return sanitizeTags(Array.from(value.matchAll(/\[([^\]\n]{1,80})\]/g), (match) => match[1] ?? ''))
}

export function parseStoryImageRequests(
  raw: string,
  characters: Array<Pick<Character, 'id' | 'name'>>,
  enabled: boolean
): StoryImageRequestParseResult {
  if (!enabled) return { visibleRaw: raw, requests: [], warnings: [] }

  const byName = new Map(characters.map((character) => [normalizeName(character.name), character]))
  const requests: StoryImageRequest[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  const visibleLines = raw.split('\n').flatMap((line) => {
    if (!IMAGE_DIRECTIVE_PREFIX_RE.test(line)) return [line]
    const match = IMAGE_DIRECTIVE_RE.exec(line)
    if (!match) {
      warnings.push('Se descartó una solicitud de imagen con formato no válido.')
      return []
    }
    const character = byName.get(normalizeName(match[1] ?? ''))
    const tags = directiveTags(match[2] ?? '')
    const prompt = (match[3] ?? '').trim()
    if (!character || !tags.length || !prompt) {
      warnings.push(`Se descartó una solicitud de imagen no válida para «${(match[1] ?? '').trim()}».`)
      return []
    }
    const key = character.id
    if (seen.has(key)) {
      warnings.push(`Se ignoró una solicitud de imagen duplicada para ${character.name}.`)
      return []
    }
    seen.add(key)
    requests.push({
      characterId: character.id,
      characterName: character.name,
      tags,
      prompt
    })
    return []
  })

  return { visibleRaw: visibleLines.join('\n'), requests, warnings }
}

export function createCharacterImageBatch(
  input: CharacterImageBatchInput,
  randomSeed?: () => number
) {
  const batch = createSwarmBatch({
    count: input.count ?? 3,
    seed: input.character.imageGenerationSeed ?? '',
    prefix: input.character.imageGenerationPromptPrefix ?? '',
    prompt: input.prompt,
    tags: input.tags,
    prompts: input.prompts
  }, randomSeed)
  return {
    total: batch.total,
    jobs: Array.from(batch.jobs, (job): CharacterImageJob => ({
      ...job,
      characterId: input.characterId,
      characterName: input.characterName
    }))
  }
}

export function createStoryImageJobs(
  requests: StoryImageRequest[],
  characters: Character[],
  randomSeed?: () => number
) {
  const batches = requests.flatMap((request) => {
    const character = characters.find((candidate) => candidate.id === request.characterId)
    if (!character) return []
    return [{
      request,
      batch: createCharacterImageBatch({
        characterId: request.characterId,
        characterName: request.characterName,
        character,
        prompt: request.prompt,
        tags: request.tags
      }, randomSeed)
    }]
  })
  const jobs: CharacterImageJob[] = []
  for (let variant = 0; variant < 3; variant += 1) {
    for (const entry of batches) {
      const job = entry.batch.jobs[variant]
      if (job) jobs.push(job)
    }
  }
  return { total: jobs.length, jobs }
}

export async function generateCharacterImage(input: {
  character: Character
  job: CharacterImageJob
  model?: string
  signal?: AbortSignal
}) {
  const preset = input.character.imageGenerationPreset?.trim() ?? ''
  const model = (input.model ?? input.character.imageGenerationModel ?? '').trim()
  if (!preset && !model) {
    throw new Error(`Configura un preset o modelo de SwarmUI para ${input.character.name}.`)
  }
  const lora = input.character.imageGenerationLora?.trim() ?? ''
  const blob = await fetchSwarmImage({
    prompt: input.job.prompt,
    ...(preset ? { preset } : {}),
    ...(model ? { model } : {}),
    ...(lora ? { lora } : {}),
    seed: String(input.job.generation.seed),
    variationSeed: input.job.generation.variationSeed,
    variationSeedStrength: input.job.generation.variationSeedStrength ?? 0,
    signal: input.signal
  })
  const generation: ImageGenerationMetadata = {
    ...input.job.generation,
    prompt: input.job.prompt,
    ...(lora ? { lora } : {}),
    ...(model ? { model } : {}),
    ...(preset ? { preset } : {})
  }
  return { blob, generation }
}

export async function runCharacterImageJobs(input: {
  jobs: Iterable<CharacterImageJob>
  characters: Character[]
  modelFor?: (job: CharacterImageJob) => string
  signal: AbortSignal
  save: (image: Awaited<ReturnType<typeof generateCharacterImage>>, job: CharacterImageJob) => Promise<void>
  progress?: (completed: number, job: CharacterImageJob) => void
}) {
  let completed = 0
  await runSwarmBatch({
    jobs: input.jobs,
    signal: input.signal,
    generate: async (job) => {
      const character = input.characters.find((candidate) => candidate.id === job.characterId)
      if (!character) throw new Error(`Personaje no disponible: ${job.characterName}.`)
      return generateCharacterImage({
        character,
        job,
        model: input.modelFor?.(job),
        signal: input.signal
      })
    },
    save: async (generated, job) => {
      await input.save(generated, job)
      input.progress?.(++completed, job)
    },
    progress: () => undefined
  })
}
