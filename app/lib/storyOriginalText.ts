import type { LlmDebugTrace, Message } from '../../shared/types/index.ts'

export function storyOriginalText(message: Message, traces: LlmDebugTrace[] = []) {
  if (message.role !== 'assistant') return message.raw
  if (message.originalRaw !== undefined) return message.originalRaw
  const trace = traces.findLast((trace) =>
    trace.storyId === message.storyId && trace.responseMessageId === message.id &&
    trace.status === 'success' && trace.request.purpose !== 'compaction' &&
    'content' in trace.response
  )
  return trace && 'content' in trace.response ? trace.response.content : message.raw
}
