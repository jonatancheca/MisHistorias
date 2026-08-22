import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import { addToLibrary, getPublication } from '../../../utils/nsfwStudio.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const body = (await readBody(event)) as Record<string, unknown>
  const publicationId = typeof body.publicationId === 'string' ? body.publicationId : ''
  if (!publicationId) throw createError({ statusCode: 400, statusMessage: 'Falta publicationId' })
  const publication = getPublication(publicationId)
  if (!publication) throw createError({ statusCode: 404, statusMessage: 'No encontrado' })
  const entry = addToLibrary(user.id, publicationId)
  return { entry, publication }
})
