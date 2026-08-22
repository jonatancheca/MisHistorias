import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import { getStorage } from '../../../utils/storage.ts'

export default defineEventHandler((event) => {
  requireSessionUser(event)
  const storage = getStorage()
  const stories = storage.list('stories', 'private', { limit: 200 }) as Array<{
    id: string
    title?: string
    updatedAt?: number
    messages?: unknown[]
  }>
  return {
    stories: stories.map((story) => ({
      id: story.id,
      title: story.title || 'Sin título',
      updatedAt: story.updatedAt || 0,
      messageCount: Array.isArray(story.messages) ? story.messages.length : 0
    }))
  }
})
