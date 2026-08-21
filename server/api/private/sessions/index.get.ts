import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import { listStorySessions } from '../../../utils/nsfwStorage.ts'

export default defineEventHandler((event) => {
  const user = requireSessionUser(event)
  const query = getQuery(event)
  const archived = query.archived === '1' || query.archived === 'true'
  return { sessions: listStorySessions(user.id, { archived }) }
})
