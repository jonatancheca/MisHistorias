import type { Message, MessageSegment } from '#shared/types'
import { isAiInstruction } from './chatInstructions.ts'

export interface VisualNovelCharacterState {
  characterId: string
  tag: string | null
  tags?: string[]
  imageId: string | null
}

export interface VisualNovelFrame {
  id: string
  messageId: string
  segmentIndex: number | null
  kind: 'user' | 'dialogue' | 'protagonist-dialogue' | 'narration'
  text: string
  backgroundId: string | null
  backgroundTag: string | null
  characterStates: VisualNovelCharacterState[]
}

interface BuildVisualNovelFramesOptions {
  initialBackgroundId: string | null
  initialBackgroundTag: string | null
  resolveBackgroundId?: (tag: string | null) => string | null
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

export function buildVisualNovelFrames(
  messages: Message[],
  options: BuildVisualNovelFramesOptions
): VisualNovelFrame[] {
  const frames: VisualNovelFrame[] = []
  let backgroundId = options.initialBackgroundId
  let backgroundTag = options.initialBackgroundTag
  let characterStates: VisualNovelCharacterState[] = []

  for (const message of messages) {
    if (message.role === 'user') {
      if (isAiInstruction(message.raw)) continue
      if (message.raw.trim()) {
        frames.push({
          id: `${message.id}:user`,
          messageId: message.id,
          segmentIndex: null,
          kind: 'user',
          text: message.raw,
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
      if (segment.type === 'sound') return

      let kind: VisualNovelFrame['kind'] = segment.type
      if (segment.type === 'dialogue' && segment.characterId) {
        const characterState = {
          characterId: segment.characterId,
          tag: segment.tag,
          tags: segment.tags?.length ? [...segment.tags] : segment.tag ? [segment.tag] : [],
          imageId: segment.imageId ?? null
        }
        characterStates = [
          ...characterStates.filter((state) => state.characterId !== segment.characterId),
          characterState
        ].slice(-2)
      } else if (segment.type === 'dialogue') {
        kind = 'narration'
      }

      const isRecognizedDialogue = segment.type === 'dialogue' && Boolean(segment.characterId)
      if (!segment.text.trim() && !isRecognizedDialogue) return

      frames.push({
        id: `${message.id}:${segmentIndex}`,
        messageId: message.id,
        segmentIndex,
        kind,
        text: segment.text,
        backgroundId,
        backgroundTag,
        characterStates: cloneCharacterStates(characterStates)
      })
    })
  }

  return frames
}
