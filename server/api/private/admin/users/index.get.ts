import { listUsers, requireAdminUser } from '../../../../utils/nsfwAuth.ts'

export default defineEventHandler((event) => {
  requireAdminUser(event)
  return { users: listUsers() }
})
