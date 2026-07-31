interface ModelsRequestBody {
  baseUrl?: string
  apiKey?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<ModelsRequestBody>(event)
  const baseUrl = assertLocalBaseUrl(body?.baseUrl)

  let response: Response
  try {
    response = await fetch(`${baseUrl}/v1/models`, {
      headers: { accept: 'application/json', ...authHeader(body?.apiKey) },
      signal: AbortSignal.timeout(10_000)
    })
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: 'No se pudo conectar con el servidor del modelo'
    })
  }

  if (!response.ok) {
    throw createError({
      statusCode: 502,
      statusMessage:
        response.status === 401 || response.status === 403
          ? 'El servidor rechazó el token de acceso'
          : `El servidor del modelo respondió ${response.status}`
    })
  }

  const payload = (await response.json()) as { data?: Array<{ id?: string }> }
  return {
    models: (payload.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string')
  }
})
