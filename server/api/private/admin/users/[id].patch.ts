import {
  readUpdateUserInput,
  requireAdminUser,
  updateUser
} from '../../../../utils/nsfwAuth.ts'

export default defineEventHandler(async (event) => {
  requireAdminUser(event)
  const userId = getRouterParam(event, 'id')
  if (!userId?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Falta el identificador' })
  }
  const user = updateUser(userId, readUpdateUserInput(await readBody(event)))
  return { user }
})
