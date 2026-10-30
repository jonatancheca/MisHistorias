import type { Background, Sound, Story } from '#shared/types'
import { SOUND_DIRECTIVE_RE } from './soundTransfer'
import { tagKey } from './tags'

export type StoryResourceOptions = Pick<Story, 'useBackgrounds' | 'useSounds'>

export function storyResourceCatalogs(story: StoryResourceOptions, backgrounds: Background[], sounds: Sound[]) {
  return {
    backgrounds: story.useBackgrounds === false ? [] : backgrounds,
    sounds: story.useSounds === false
      ? []
      : sounds.filter(sound => story.useBackgrounds !== false || !sound.backgroundId)
  }
}

export function filterStoryResourceDirectives(raw: string, story: StoryResourceOptions, sounds: Sound[] = []) {
  if (story.useBackgrounds !== false && story.useSounds !== false) return raw
  const excludedSoundTags = new Set(
    story.useBackgrounds === false
      ? sounds.filter(sound => sound.backgroundId).flatMap(sound => sound.tags.map(tagKey))
      : []
  )
  return raw.split('\n').filter(line => {
    if (story.useBackgrounds === false && /^\s*Fondo\s*\[[^\]\n]{1,80}\]\s*:/i.test(line)) return false
    const sound = SOUND_DIRECTIVE_RE.exec(line)
    return !sound || (story.useSounds !== false && !excludedSoundTags.has(tagKey(sound[1]!)))
  }).join('\n')
}
