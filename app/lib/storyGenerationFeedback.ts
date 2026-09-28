import type { LlmDebugTrace, Message, StoryGenerationAttempt } from '../../shared/types/index.ts'

export interface StoryGenerationFeedback {
  message: string
  warning: boolean
  retry?: StoryGenerationAttempt
  traceId?: string
}

export function storyGenerationErrorMessage(message: string, status?: number) {
  return status ? `HTTP ${status} · ${message}` : message
}

export function latestStoryGenerationFeedback(
  traces: LlmDebugTrace[],
  messages: Message[]
): StoryGenerationFeedback | null {
  const trace = [...traces].reverse().find((item) => item.request.purpose !== 'compaction')
  if (!trace || trace.request.generation?.dismissed) return null
  const history = messages.filter((message) => !message.swarmError)
  if (trace.status === 'success' && trace.responseMessageId) {
    if (
      !('finishReason' in trace.response) || trace.response.finishReason !== 'length' ||
      history.at(-1)?.id !== trace.responseMessageId
    ) return null
    return {
      message: 'La respuesta alcanzó el máximo de tokens. Se ha conservado el contenido parcial.',
      warning: true,
      traceId: trace.id
    }
  }
  const attempt = trace.request.generation
  if (attempt) {
    if (
      history.length !== attempt.historyMessageIds.length ||
      history.some((message, index) => message.id !== attempt.historyMessageIds[index])
    ) return null
  } else if (history.some((message) => message.createdAt > trace.createdAt)) {
    return null
  }
  const message = 'error' in trace.response
    ? storyGenerationErrorMessage(trace.response.error, trace.response.status)
    : trace.response.finishReason === 'length'
      ? 'El modelo alcanzó el máximo de tokens antes de devolver contenido visible.'
      : 'El modelo no devolvió contenido visible.'
  return {
    message,
    warning: false,
    // Una respuesta que ya se guardó no puede repetirse sin duplicar contenido.
    retry: !trace.responseMessageId ? attempt : undefined,
    traceId: trace.id
  }
}
