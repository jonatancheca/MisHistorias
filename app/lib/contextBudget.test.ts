import assert from 'node:assert/strict'
import test from 'node:test'
import { contextFits, exceededContextLimit, tokenContextUsage, summarizeInBlocks } from './contextBudget.ts'

test('los dos límites deben cumplirse y cero desactiva el de caracteres', () => {
  const usage = { ...tokenContextUsage(500, 8192, 1000, 600, 'modelo'), characters: { count: 2000, limit: 2000 } }
  assert.equal(contextFits(usage), true)
  usage.characters.count = 2001
  assert.equal(contextFits(usage), false)
  assert.deepEqual(exceededContextLimit(usage), { count: 2001, limit: 2000, unit: 'caracteres' })
  usage.characters.limit = 0
  assert.equal(contextFits(usage), true)
  usage.count = 601
  assert.equal(contextFits(usage), false)
  assert.deepEqual(exceededContextLimit(usage), { count: 601, limit: 600, unit: 'tokens' })
})

test('reserva salida sobre capacidad cargada y respeta límite manual o cero', () => {
  assert.equal(tokenContextUsage(22768, 32768, 10000, 40000, 'modelo').effectiveLimit, 22768)
  assert.equal(contextFits(tokenContextUsage(22768, 32768, 10000, 0, 'modelo')), true)
  assert.equal(contextFits(tokenContextUsage(22769, 32768, 10000, 0, 'modelo')), false)
  assert.equal(tokenContextUsage(3000, 32768, 10000, 3000, 'modelo').effectiveLimit, 3000)
  assert.throws(() => tokenContextUsage(1, 8192, 10000, 0, 'modelo'), /toda la capacidad/)
  assert.throws(() => tokenContextUsage(NaN, 8192, 1000, 3000, 'modelo'), /medición válida/)
})

test('bloques conservan todo el texto, roles y Unicode de un mensaje excesivo', async () => {
  const seen: Array<{ role: string; content: string }> = []
  const summaries: string[] = []
  const history = [{ role: 'user' as const, content: 'A😀BC😀D' }, { role: 'assistant' as const, content: 'EFGH' }]
  const result = await summarizeInBlocks({
    history, previousSummary: 'Previo', signal: new AbortController().signal,
    fits: async (_summary, messages) => messages.reduce((total, message) => total + Array.from(message.content).length, 0) <= 3,
    summarize: async (previous, messages) => {
      summaries.push(previous)
      seen.push(...messages)
      return `Resumen ${summaries.length}`
    }
  })
  assert.equal(seen.filter(item => item.role === 'user').map(item => item.content).join(''), history[0]!.content)
  assert.equal(seen.filter(item => item.role === 'assistant').map(item => item.content).join(''), history[1]!.content)
  assert.equal(summaries[0], 'Previo')
  assert.equal(summaries[1], 'Resumen 1')
  assert.equal(result, `Resumen ${summaries.length}`)
})

test('bloques rechazan falta de espacio y respetan cancelación entre llamadas', async () => {
  const controller = new AbortController()
  const options = {
    history: [{ role: 'user' as const, content: 'ABCD' }], previousSummary: '', signal: controller.signal,
    fits: async () => false, summarize: async () => 'No debe resumir'
  }
  await assert.rejects(summarizeInBlocks(options), /no dejan espacio/)
  controller.abort()
  await assert.rejects(summarizeInBlocks(options), { name: 'AbortError' })
})
