import type { Character } from '../../shared/types/index.ts'
import { fetchChromeLlmChat } from './chromeLlm.ts'
import { fetchLlmChat } from './llm.ts'

interface PromptInput {
  character: Character
  tags: string[]
  notes: string
}

interface PromptProviderSettings {
  useChromeLlm: boolean
  model: string
  temperature: number
}

interface PromptProviders {
  chrome: typeof fetchChromeLlmChat
  lmStudio: typeof fetchLlmChat
}

export function buildCharacterImagePromptMessages(input: PromptInput) {
  return [
    {
      role: 'system' as const,
      content: [
        'Write exactly one concise English text-to-image prompt for a character portrait.',
        'Explicitly include the pose, clothing, and visible emotion.',
        'Use concrete visual language. Return only the prompt in plain text.',
        'Never include LoRA or preset syntax, angle-bracket commands, model names, or commentary.'
      ].join(' ')
    },
    {
      role: 'user' as const,
      content: [
        `Character name: ${input.character.name}`,
        `Character description: ${input.character.prompt}`,
        `Character traits: ${input.character.tags.join(', ') || 'not specified'}`,
        `Requested image tags: ${input.tags.join(', ') || 'not specified'}`,
        `Additional notes: ${input.notes.trim() || 'not specified'}`
      ].join('\n')
    }
  ]
}

export function cleanCharacterImagePrompt(value: string) {
  return value
    .replace(/```(?:text)?/gi, '')
    .replace(/<\s*(?:lora|preset)\b[^>]*>/gi, '')
    .replace(/\b(?:lora|preset)\s*:[^,\n]+/gi, '')
    .replace(/^\s*["']|["']\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export async function generateCharacterImagePrompt(
  input: PromptInput,
  settings: PromptProviderSettings,
  signal?: AbortSignal,
  providers: PromptProviders = {
    chrome: fetchChromeLlmChat,
    lmStudio: fetchLlmChat
  }
) {
  const messages = buildCharacterImagePromptMessages(input)
  const result = settings.useChromeLlm
    ? await providers.chrome({ messages, signal })
    : settings.model
      ? await providers.lmStudio({
          model: settings.model,
          messages,
          temperature: settings.temperature,
          maxTokens: 350,
          signal
        })
      : (() => { throw new Error('Configura primero el modelo en Ajustes.') })()
  const prompt = cleanCharacterImagePrompt(result.content)
  if (!prompt) throw new Error('El modelo no devolvió un prompt de imagen.')
  return prompt
}
