import { logoutUser } from '../../../utils/nsfwAuth.ts'

export default defineEventHandler((event) => {
  logoutUser(event)
  return { ok: true }
})
