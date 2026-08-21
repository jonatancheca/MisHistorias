import { bootstrapAdmin, readCredentials } from '../../../utils/nsfwAuth.ts'

export default defineEventHandler(async (event) => {
  const { username, password } = readCredentials(await readBody(event))
  const user = bootstrapAdmin(event, username, password)
  return { user }
})
