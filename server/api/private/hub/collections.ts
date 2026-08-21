import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import {
  addToCollection,
  createCollection,
  listCollections
} from '../../../utils/nsfwStudio.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  if (event.method === 'GET') return { collections: listCollections(user.id) }
  const body = (await readBody(event)) as Record<string, unknown>
  if (body.action === 'add') {
    return addToCollection(
      user.id,
      typeof body.collectionId === 'string' ? body.collectionId : '',
      typeof body.publicationId === 'string' ? body.publicationId : ''
    )
  }
  const collection = createCollection(user.id, {
    title: typeof body.title === 'string' ? body.title : '',
    summary: typeof body.summary === 'string' ? body.summary : ''
  })
  return { collection }
})
