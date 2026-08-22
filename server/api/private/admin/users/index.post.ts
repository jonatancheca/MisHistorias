import { createUser, readCreateUserInput, requireAdminUser } from '../../../../utils/nsfwAuth.ts'

export default defineEventHandler(async (event) => {
  requireAdminUser(event)
  const user = createUser(readCreateUserInput(await readBody(event)))
  return { user }
})
