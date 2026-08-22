import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import { getUsageSummary } from '../../../utils/nsfwProduct.ts'

export default defineEventHandler((event) => {
  const user = requireSessionUser(event)
  return { usage: getUsageSummary(user.id) }
})
