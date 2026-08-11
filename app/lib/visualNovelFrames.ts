import type { Message, MessageSegment } from '#shared/types'

export interface VisualNovelCharacterState {
  characterId: string
  tag: string | null
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
  characterState: VisualNovelCharacterState | null
}

interface BuildVisualNovelFramesOptions {
  initialBackgroundId: string | null
  initialBackgroundTag: string | null
  resolveBackgroundId?: (tag: string | null) => string | null
}

function hasBackgroundId(segment: MessageSegment) {
  return Object.prototype.hasOwnProperty.call(segment, 'backgroundId')
}

export function buildVisualNovelFrames(
  messages: Message[],
  options: BuildVisualNovelFramesOptions
): VisualNovelFrame[] {
  const frames: VisualNovelFrame[] = []
  let backgroundId = options.initialBackgroundId
  let backgroundTag = options.initialBackgroundTag
  let characterState: VisualNovelCharacterState | null = null

  for (const message of messages) {
    if (message.role === 'user') {
      if (message.raw.trim()) {
        frames.push({
          id: `${message.id}:user`,
          messageId: message.id,
          segmentIndex: null,
          kind: 'user',
          text: message.raw,
          backgroundId,
          backgroundTag,
          characterState: characterState ? { ...characterState } : null
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
      if (!segment.text.trim()) return

      let kind: VisualNovelFrame['kind'] = segment.type
      if (segment.type === 'dialogue' && segment.characterId) {
        characterState = {
          characterId: segment.characterId,
          tag: segment.tag,
          imageId: segment.imageId ?? null
        }
      } else if (segment.type === 'dialogue') {
        kind = 'narration'
      }

      frames.push({
        id: `${message.id}:${segmentIndex}`,
        messageId: message.id,
        segmentIndex,
        kind,
        text: segment.text,
        backgroundId,
        backgroundTag,
        characterState: characterState ? { ...characterState } : null
      })
    })
  }

  return frames
}
