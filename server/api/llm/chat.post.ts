interface ChatRequestBody {
  baseUrl?: string
  apiKey?: string
  model?: string
  messages?: Array<{ role: string; content: string }>
  temperature?: number
  maxTokens?: number
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: unknown }
    finish_reason?: unknown
  }>
}

export function stripThinkingBlocks(content: string) {
  return content
    .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '')
    .replace(/<think\b[^>]*>[\s\S]*$/gi, '')
    .trim()
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
        stream: false
      })
    })
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: 'No se pudo conectar con el servidor del modelo'
    })
  }

  if (!response.ok) {
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

  let completion: ChatCompletionResponse
  try {
    completion = (await response.json()) as ChatCompletionResponse
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: 'El servidor del modelo devolvió una respuesta no válida'
    })
  }

  const choice = completion.choices?.[0]
  const content =
    typeof choice?.message?.content === 'string' ? stripThinkingBlocks(choice.message.content) : ''
  const finishReason =
    typeof choice?.finish_reason === 'string' ? choice.finish_reason : null

  return { content, finishReason }
})
