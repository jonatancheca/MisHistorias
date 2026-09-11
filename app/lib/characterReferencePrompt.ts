import type { DataScope } from './db.ts'
import { cleanCharacterImagePrompt } from './characterImagePrompt.ts'
import { fetchLlmChat, type LlmMessage } from './llm.ts'

export const CHARACTER_REFERENCE_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp'
] as const

export const DEFAULT_CHARACTER_REFERENCE_PROMPT = [
  'Create exactly one concise English ComfyUI text-to-image prompt from the reference photo.',
  'Describe only the character\'s stable visible identity and characteristic outfit:',
  'apparent age, build, skin, face, eyes when visible, hair, distinctive features, clothing, and accessories.',
  'Do not describe pose, emotion, action, background, framing, camera, lighting, image quality, or art style.',
  'Do not guess details that are not visible.',
  'Return only the positive prompt as plain text.',
  'Never include reasoning, Markdown, a negative prompt, LoRA or preset syntax, model names, or commentary.'
].join(' ')

interface CharacterReferencePromptOptions {
  model: string
  temperature: number
  maxTokens: number
  systemPrompt: string
  scope: DataScope
  signal?: AbortSignal
}

interface CharacterReferencePromptProvider {
  chat: typeof fetchLlmChat
}

interface CharacterReferencePromptError extends Error {
  messages?: LlmMessage[]
  response?: unknown
}

export function isSupportedCharacterReferenceImage(file: File) {
  return (CHARACTER_REFERENCE_IMAGE_TYPES as readonly string[]).includes(file.type.toLowerCase())
}

export async function imageFileDataUrl(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return `data:${file.type.toLowerCase()};base64,${btoa(binary)}`
}

export function buildCharacterReferencePromptMessages(
  systemPrompt: string,
  imageDataUrl: string
): LlmMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Create the reusable character prompt for ComfyUI from this reference photo.'
        },
        { type: 'image_url', image_url: { url: imageDataUrl } }
      ]
    }
  ]
}

export function cleanCharacterReferencePrompt(value: string) {
  return cleanCharacterImagePrompt(
    value
      .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '')
      .replace(/<think\b[^>]*>[\s\S]*$/gi, '')
      .replace(/```(?:text|plaintext|markdown)?/gi, '')
      .replace(/^\s*(?:positive\s+)?prompt\s*:\s*/i, '')
      .replace(/\bnegative\s+prompt\s*:[\s\S]*$/i, '')
  )
}

export async function generateCharacterReferencePrompt(
  file: File,
  options: CharacterReferencePromptOptions,
  provider: CharacterReferencePromptProvider = { chat: fetchLlmChat }
) {
  if (!isSupportedCharacterReferenceImage(file)) {
    throw new Error('Solo se admiten fotos JPEG, PNG o WebP.')
  }
  const model = options.model.trim()
  if (!model) throw new Error('Configura primero un modelo visual de LM Studio en Ajustes.')
  const messages = buildCharacterReferencePromptMessages(
    options.systemPrompt,
    await imageFileDataUrl(file)
  )
  let result: Awaited<ReturnType<typeof fetchLlmChat>>
  try {
    result = await provider.chat({
      model,
      messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      scope: options.scope,
      signal: options.signal
    })
  } catch (caught) {
    const source = caught instanceof Error ? caught : new Error(String(caught))
    throw Object.assign(source, {
      messages,
      response: { error: source.message || 'Fallo del modelo' }
    }) as CharacterReferencePromptError
  }
  const response = { content: result.content, finishReason: result.finishReason }
  if (result.finishReason === 'length') {
    throw Object.assign(new Error('La respuesta del modelo quedó truncada.'), { messages, response })
  }
  const prompt = cleanCharacterReferencePrompt(result.content)
  if (!prompt) {
    throw Object.assign(new Error('El modelo no devolvió un prompt visual.'), { messages, response })
  }
  return prompt
}
