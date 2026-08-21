import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import { listHub } from '../../../utils/nsfwStudio.ts'

export default defineEventHandler((event) => {
  requireSessionUser(event)
  const query = getQuery(event)
  return {
    listings: listHub({
      type: typeof query.type === 'string' ? query.type : undefined,
      q: typeof query.q === 'string' ? query.q : undefined
    })
  }
})
