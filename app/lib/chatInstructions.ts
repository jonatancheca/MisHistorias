const AI_INSTRUCTION_PREFIX = /^\s*IA:\s*/

export function isAiInstruction(value: string) {
  return AI_INSTRUCTION_PREFIX.test(value)
}

export function extractAiInstruction(value: string) {
  if (!isAiInstruction(value)) return null
  const instruction = value.replace(AI_INSTRUCTION_PREFIX, '').trim()
  return instruction || null
}
