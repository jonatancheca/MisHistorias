import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import { createProductFeedback } from '../../../utils/nsfwProduct.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const body = (await readBody(event)) as Record<string, unknown>
  const kind = body.kind
  if (
    kind !== 'bug' &&
    kind !== 'suggestion' &&
    kind !== 'checkpoint' &&
    kind !== 'survey' &&
    kind !== 'thumb'
  ) {
    throw createError({ statusCode: 400, statusMessage: 'kind inválido' })
  }
  const feedback = createProductFeedback({
    userId: user.id,
    kind,
    body: typeof body.body === 'string' ? body.body : '',
    score: typeof body.score === 'number' ? body.score : null,
    sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
    attemptId: typeof body.attemptId === 'string' ? body.attemptId : null,
    metadata: typeof body.metadata === 'object' && body.metadata ? (body.metadata as Record<string, unknown>) : {}
  })
  return { feedback }
})
