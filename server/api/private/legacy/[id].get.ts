import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import { getStorage } from '../../../utils/storage.ts'

export default defineEventHandler((event) => {
  requireSessionUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta id' })
  const story = getStorage().get('stories', 'private', id) as {
    id: string
    title?: string
    messages?: Array<{ role?: string; content?: string; text?: string }>
  } | null
  if (!story) throw createError({ statusCode: 404, statusMessage: 'Historia legado no encontrada' })
  return {
    story: {
      id: story.id,
      title: story.title || 'Sin título',
      messages: (story.messages || []).map((message) => ({
        role: message.role || 'assistant',
        text: message.content || message.text || ''
      }))
    }
  }
})
