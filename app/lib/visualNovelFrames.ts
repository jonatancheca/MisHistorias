import type { LlmDebugTrace, Message, MessageSegment } from '#shared/types'
import { isAiInstruction } from './chatInstructions.ts'
import { stripBracketedText } from './storyDisplayText.ts'

export interface VisualNovelCharacterState {
  characterId: string
  tag: string | null
  tags?: string[]
  imageId: string | null
  imageIdOverride: boolean
  sourceMessageId: string
  sourceSegmentIndex: number
}

export interface VisualNovelFrame {
  id: string
  messageId: string | null
  segmentIndex: number | null
  kind: 'user' | 'dialogue' | 'protagonist-dialogue' | 'thought' | 'protagonist-thought' | 'narration' | 'sound' | 'compaction'
  text: string
  compactionTrace?: LlmDebugTrace
  soundId?: string | null
  soundTag?: string | null
  backgroundId: string | null
  backgroundTag: string | null
  characterStates: VisualNovelCharacterState[]
}

interface BuildVisualNovelFramesOptions {
  initialBackgroundId: string | null
  initialBackgroundTag: string | null
  resolveBackgroundId?: (tag: string | null) => string | null
  resolveSoundId?: (tag: string | null) => string | null
  compactionTraces?: LlmDebugTrace[]
}

function hasBackgroundId(segment: MessageSegment) {
  return Object.prototype.hasOwnProperty.call(segment, 'backgroundId')
}

function cloneCharacterStates(states: VisualNovelCharacterState[]) {
  return states.map((state) => ({
    ...state,
    tags: state.tags ? [...state.tags] : undefined
  }))
}

export function visualNovelCharacterCapacity(width: number) {
  if (!Number.isFinite(width) || width <= 0) return 2
  return Math.max(2, Math.floor(width / 240))
}

export function resolveVisualNovelFrameIndex(
  currentIndex: number,
  previousLength: number,
  length: number,
  manualAdvance: boolean
) {
  if (length === 0) return 0
  const safeCurrentIndex = Math.min(Math.max(0, currentIndex), length - 1)
  if (manualAdvance && previousLength > 0) return safeCurrentIndex
  const wasAtEnd = previousLength === 0 || currentIndex >= previousLength - 1
  return wasAtEnd ? length - 1 : safeCurrentIndex
}

export function withPendingAssistantMessage(
  messages: Message[],
  pending: Message | null
) {
  if (!pending) return messages
  const index = messages.findIndex((message) => message.id === pending.id)
  if (index < 0) return [...messages, pending]
  return messages.map((message, messageIndex) =>
    messageIndex === index ? pending : message
  )
}

export function buildVisualNovelFrames(
  messages: Message[],
  options: BuildVisualNovelFramesOptions
): VisualNovelFrame[] {
  const frames: VisualNovelFrame[] = []
  let backgroundId = options.initialBackgroundId
  let backgroundTag = options.initialBackgroundTag
  let characterStates: VisualNovelCharacterState[] = []

  type Item = { message: Message; createdAt: number } | { trace: LlmDebugTrace; createdAt: number }
  const items: Item[] = messages.map((message) => ({ message, createdAt: message.createdAt }))
  const messageIds = new Set(messages.map((message) => message.id))
  const anchored = new Map<string, Item[]>()
  for (const trace of [...(options.compactionTraces ?? [])].sort((a, b) => a.createdAt - b.createdAt)) {
    if (trace.request.purpose !== 'compaction') continue
    const item = { trace, createdAt: trace.createdAt }
    if (trace.requestMessageId && messageIds.has(trace.requestMessageId)) {
      anchored.set(trace.requestMessageId, [...(anchored.get(trace.requestMessageId) ?? []), item])
    } else items.push(item)
  }
  const timeline = items.sort((a, b) => a.createdAt - b.createdAt).flatMap((item) =>
    'message' in item ? [item, ...(anchored.get(item.message.id) ?? [])] : [item]
  )

  for (const item of timeline) {
    if ('trace' in item) {
      const trace = item.trace
      frames.push({
        id: `${trace.id}:compaction`,
        messageId: null,
        segmentIndex: null,
        kind: 'compaction',
        text: ('content' in trace.response ? trace.response.content : trace.response.error) || 'Sin texto de compactación.',
        compactionTrace: trace,
        backgroundId,
        backgroundTag,
        characterStates: cloneCharacterStates(characterStates)
      })
      continue
    }
    const message = item.message
    if (message.swarmError) continue
    if (message.role === 'user') {
      if (isAiInstruction(message.raw)) continue
      const visibleText = stripBracketedText(message.raw)
      if (visibleText) {
        frames.push({
          id: `${message.id}:user`,
          messageId: message.id,
          segmentIndex: null,
          kind: 'user',
          text: visibleText,
          backgroundId,
          backgroundTag,
          characterStates: cloneCharacterStates(characterStates)
        })
      }
      continue
    }

    message.segments.forEach((segment, segmentIndex) => {
      if (segment.type === 'background') {
        backgroundId = hasBackgroundId(segment)
          ? (segment.backgroundId ?? null)
          : (options.resolveBackgroundId?.(segment.tag) ?? null)
        backgroundTag = segment.tag
        return
      }
      if (segment.type === 'sound') {
        frames.push({
          id: `${message.id}:${segmentIndex}`,
          messageId: message.id,
          segmentIndex,
          kind: 'sound',
          text: stripBracketedText(segment.text),
          soundId: Object.prototype.hasOwnProperty.call(segment, 'soundId')
            ? (segment.soundId ?? null)
            : (options.resolveSoundId?.(segment.tag) ?? null),
          soundTag: segment.tag,
          backgroundId,
          backgroundTag,
          characterStates: cloneCharacterStates(characterStates)
        })
        return
      }

      let kind: VisualNovelFrame['kind'] = segment.type
      if ((segment.type === 'dialogue' || segment.type === 'thought') && segment.characterId) {
        const characterState = {
          characterId: segment.characterId,
          tag: segment.tag,
          tags: segment.tags?.length ? [...segment.tags] : segment.tag ? [segment.tag] : [],
          imageId: segment.imageId ?? null,
          imageIdOverride: segment.imageIdOverride === true,
          sourceMessageId: message.id,
          sourceSegmentIndex: segmentIndex
        }
        characterStates = [
          ...characterStates.filter((state) => state.characterId !== segment.characterId),
          characterState
        ]
      } else if (segment.type === 'dialogue' || segment.type === 'thought') {
        kind = 'narration'
      }

      const isRecognizedDialogue = (
        ((segment.type === 'dialogue' || segment.type === 'thought') && Boolean(segment.characterId)) ||
        segment.type === 'protagonist-dialogue' || segment.type === 'protagonist-thought'
      )
      const visibleText = stripBracketedText(segment.text)
      if (!visibleText && !isRecognizedDialogue) return

      frames.push({
        id: `${message.id}:${segmentIndex}`,
        messageId: message.id,
        segmentIndex,
        kind,
        text: visibleText,
        backgroundId,
        backgroundTag,
        characterStates: cloneCharacterStates(characterStates)
      })
    })
  }

  return frames
}
