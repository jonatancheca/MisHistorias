import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import { listLibrary } from '../../../utils/nsfwStudio.ts'

export default defineEventHandler((event) => {
  const user = requireSessionUser(event)
  return { entries: listLibrary(user.id) }
})
