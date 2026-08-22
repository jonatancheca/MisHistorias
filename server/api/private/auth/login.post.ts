import { loginUser, readCredentials } from '../../../utils/nsfwAuth.ts'

export default defineEventHandler(async (event) => {
  const { username, password } = readCredentials(await readBody(event))
  const user = loginUser(event, username, password)
  return { user }
})
