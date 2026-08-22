import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import { publishResource, withdrawPublication } from '../../../../utils/nsfwStudio.ts'
import type { HubResourceType } from '../../../../../shared/types/nsfw/studio.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const body = (await readBody(event)) as Record<string, unknown>
  if (event.method === 'DELETE' || body.action === 'withdraw') {
    const id = typeof body.publicationId === 'string' ? body.publicationId : ''
    return { publication: withdrawPublication(id, user.id) }
  }
  const resourceType = body.resourceType as HubResourceType
  const resourceId = typeof body.resourceId === 'string' ? body.resourceId : ''
  if (!resourceType || !resourceId) {
    throw createError({ statusCode: 400, statusMessage: 'Faltan resourceType/resourceId' })
  }
  const publication = publishResource(user.id, {
    resourceType,
    resourceId,
    title: typeof body.title === 'string' ? body.title : undefined,
    summary: typeof body.summary === 'string' ? body.summary : undefined,
    tags: Array.isArray(body.tags) ? body.tags.filter((item): item is string => typeof item === 'string') : []
  })
  return { publication }
})
