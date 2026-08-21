import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import { upsertVnSave } from '../../../../utils/nsfwVn.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })
  const body = (await readBody(event)) as Record<string, unknown>
  const save = upsertVnSave({
    sessionId: id,
    ownerUserId: user.id,
    label: typeof body.label === 'string' ? body.label : 'Guardado',
    headBeatId: typeof body.headBeatId === 'string' ? body.headBeatId : null,
    isAutosave: Boolean(body.isAutosave),
    payload: body.payload && typeof body.payload === 'object' ? (body.payload as Record<string, unknown>) : {}
  })
  return { save }
})
