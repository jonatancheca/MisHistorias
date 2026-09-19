import {
  parseAccessConfiguration,
  requireAccessAdmin,
  requireAccessIdentity
} from '../../utils/access.ts'
import { getStorage } from '../../utils/storage.ts'

export default defineEventHandler(async (event) => {
  const session = await requireAccessAdmin(event)
  if (!session.multiUserEnabled || !session.identity) {
    throw createError({ statusCode: 409, statusMessage: 'El modo multiusuario no está activo' })
  }

  const configuration = parseAccessConfiguration(await readBody(event))
  const proposedIdentity = await requireAccessIdentity(event, configuration)
  if (
    proposedIdentity.id !== session.identity.id ||
    proposedIdentity.email !== session.identity.email
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'La nueva configuración no valida la identidad administradora actual'
    })
  }

  getStorage().writeSettings({
    accessTeamDomain: configuration.teamDomain,
    accessAudience: configuration.audience
  })
  return configuration
})
