import type { MessageSegment } from '#shared/types'
import { sanitizeTags, tagKey } from './tags.ts'

function visualTagKey(segment: MessageSegment) {
  return sanitizeTags(segment.tags?.length ? segment.tags : undefined, segment.tag)
    .map(tagKey)
    .sort()
    .join('\u0000')
}

export function replaceFollowingMatchingDialogueImages(
  segments: MessageSegment[],
  segmentIndex: number,
  imageId: string
) {
  const target = segments[segmentIndex]
  if (target?.type !== 'dialogue' || !target.characterId) return segments
  const targetTags = visualTagKey(target)

  return segments.map((segment, index) => {
    const matches = index >= segmentIndex && (
      index === segmentIndex || (
        segment.type === 'dialogue' &&
        segment.characterId === target.characterId &&
        visualTagKey(segment) === targetTags
      )
    )
    return matches ? { ...segment, imageId, imageIdOverride: true } : segment
  })
}
