interface ChatRequestBody {
  baseUrl?: string
  apiKey?: string
  model?: string
  messages?: Array<{ role: string; content: string }>
  temperature?: number
  maxTokens?: number
}

export default defineEventHandler(async (event) => {
  const body = await readBody<ChatRequestBody>(event)
  const baseUrl = assertLocalBaseUrl(body?.baseUrl)

  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Faltan mensajes' })
  }
  if (!body.model) {
    throw createError({ statusCode: 400, statusMessage: 'Falta el modelo' })
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(body?.apiKey) },
      body: JSON.stringify({
        model: body.model,
        messages: body.messages,
        temperature: body.temperature ?? 0.8,
        max_tokens: body.maxTokens ?? 800,
        stream: true
      })
    })
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: 'No se pudo conectar con el servidor del modelo'
    })
  }

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '')
    throw createError({
      statusCode: 502,
      statusMessage:
        response.status === 401 || response.status === 403
          ? 'El servidor rechazó el token de acceso'
          : `El servidor del modelo respondió ${response.status}`,
      data: detail.slice(0, 500)
    })
  }

  setResponseHeaders(event, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  })
  return sendStream(event, response.body)
})
