import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import { followCreator, listFollows, unfollowCreator } from '../../../utils/nsfwStudio.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  if (event.method === 'GET') return { follows: listFollows(user.id) }
  const body = (await readBody(event)) as Record<string, unknown>
  const followedUserId = typeof body.userId === 'string' ? body.userId : ''
  if (!followedUserId) throw createError({ statusCode: 400, statusMessage: 'Falta userId' })
  if (body.action === 'unfollow') return unfollowCreator(user.id, followedUserId)
  return followCreator(user.id, followedUserId)
})
