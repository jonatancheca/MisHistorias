import JSZip from 'jszip'
import { fetchLlmChat, type LlmMessage } from './llm.ts'

export const LORA_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export interface LoraCaptionResult {
  caption: string
  finishReason: string | null
  messages: LlmMessage[]
  response: { content: string; finishReason: string | null }
}

interface LoraCaptionError extends Error {
  messages?: LlmMessage[]
  response?: unknown
}

export interface LoraZipEntry {
  filename: string
  content: string
}

export function isSupportedLoraImage(file: File) {
  return (LORA_IMAGE_TYPES as readonly string[]).includes(file.type.toLowerCase())
}

export function buildLoraCaptionMessages(imageDataUrl: string): LlmMessage[] {
  return [
    {
      role: 'system',
      content:
        'Describe the visible content of the image for training a character LoRA. Return one brief English sentence or comma-separated visual description only. Include subject, appearance, clothing, pose, expression, and setting when visible. Do not include reasoning, a title, Markdown, boilerplate, or anything that is not visible.'
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Write the caption that will be used directly in the accompanying TXT file.' },
        { type: 'image_url', image_url: { url: imageDataUrl } }
      ]
    }
  ]
}

export function cleanLoraCaption(value: string) {
  return value
    .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '')
    .replace(/<think\b[^>]*>[\s\S]*$/gi, '')
    .replace(/```(?:text|plaintext|markdown)?/gi, '')
    .replace(/^\s*(?:caption|description)\s*:\s*/i, '')
    .replace(/^\s*["']|["']\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function finalLoraText(prefix: string, caption: string) {
  const cleanCaption = cleanLoraCaption(caption)
  return prefix.trim() ? `${prefix.trim()} ${cleanCaption}`.trim() : cleanCaption
}

export function textFilename(name: string) {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? 'imagen'
  const withoutExtension = base.replace(/\.[^.]+$/, '') || 'imagen'
  return `${withoutExtension}.txt`
}

export function duplicateTextFilenames(files: File[]) {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const file of files) {
    const filename = textFilename(file.name)
    const key = filename.toLocaleLowerCase()
    if (seen.has(key)) duplicates.add(filename)
    seen.add(key)
  }
  return [...duplicates]
}

async function fileDataUrl(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return `data:${file.type.toLowerCase()};base64,${btoa(binary)}`
}

export async function generateLoraCaption(
  file: File,
  options: { model: string; temperature: number; maxTokens: number; signal?: AbortSignal }
): Promise<LoraCaptionResult> {
  const messages = buildLoraCaptionMessages(await fileDataUrl(file))
  let result: Awaited<ReturnType<typeof fetchLlmChat>>
  try {
    result = await fetchLlmChat({ ...options, messages })
  } catch (caught) {
    const source = caught as Error
    const error = Object.assign(source instanceof Error ? source : new Error(String(caught)), {
      messages,
      response: { error: source.message || 'Fallo del modelo' }
    }) as LoraCaptionError
    throw error
  }
  const caption = cleanLoraCaption(result.content)
  const response = { content: result.content, finishReason: result.finishReason }
  if (!caption) throw Object.assign(new Error('El modelo no devolvió una descripción.'), { messages, response })
  if (result.finishReason === 'length') throw Object.assign(new Error('La respuesta del modelo quedó truncada.'), { messages, response })
  return { caption, finishReason: result.finishReason, messages, response }
}

export async function createLoraZip(entries: LoraZipEntry[]) {
  const zip = new JSZip()
  for (const entry of entries) zip.file(entry.filename, entry.content)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}
