import type { LlmDebugTrace, Message, Story } from '../../shared/types'
import { test, expect } from './fixtures'

type ChatMessage = { role: string; content: string }
type Block = { previousSummary: string; history: ChatMessage[] }
interface ChromeState { measurements: string[]; prompts: ChatMessage[][] }

function blockBody(messages: ChatMessage[]): Block | null {
  try {
    const body = JSON.parse(messages[1]?.content ?? '')
    return typeof body.previousSummary === 'string' && Array.isArray(body.history) ? body : null
  } catch { return null }
}

// El proveedor de prueba asigna un token a cada WORD258 y 300 a instrucciones y resumen.
// Estas cifras son un contrato del doble de prueba; la aplicación usa la medición del proveedor.
const capacity = 12300
const testTokens = (messages: ChatMessage[]) => 300 + (JSON.stringify(messages).match(/WORD258/g)?.length ?? 0)

for (const scenario of [
  { provider: 'LM Studio', manual: true, scope: 'normal', visualMode: false },
  { provider: 'LM Studio', manual: false, scope: 'private', visualMode: true },
  { provider: 'Chrome', manual: true, scope: 'private', visualMode: true },
  { provider: 'Chrome', manual: false, scope: 'normal', visualMode: false }
] as const) {
  test(`33000 tokens sin cientos de mediciones: ${scenario.provider}, ${scenario.manual ? 'manual' : 'continuación'}, ${scenario.scope}`, async ({ page, data }) => {
    test.setTimeout(60000)
    const chrome = scenario.provider === 'Chrome'
    await data.patchSettings({ mockMode: false, model: 'test-model', useChromeLlm: chrome,
      privateLlmSettingsEnabled: true, privateModel: 'private-model', privateUseChromeLlm: chrome,
      contextUnit: 'tokens', privateContextUnit: 'tokens', historyBudget: 0, privateHistoryBudget: 0,
      contextTokenBudget: 12000, privateContextTokenBudget: 12000, maxTokens: 100, privateMaxTokens: 100,
      responseSpeed: 'instant', narrativePrompt: 'Narra la historia.', compactionPrompt: null })
    await page.route('**/api/llm/model-status?*', route => route.fulfill({ json: { loaded: true } }))
    const measurements: string[] = []
    const prompts: ChatMessage[][] = []
    if (chrome) await page.addInitScript(() => {
      const state = window as unknown as ChromeState
      state.measurements = []
      state.prompts = []
      class FakeLanguageModel {
        contextWindow = 12300
        contextUsage = 0
        static async availability() { return 'available' }
        static async create() { return new FakeLanguageModel() }
        async measureContextUsage(messages: ChatMessage[]) {
          state.measurements.push(JSON.stringify(messages))
          return 300 + (JSON.stringify(messages).match(/WORD258/g)?.length ?? 0)
        }
        async prompt(messages: ChatMessage[]) {
          state.prompts.push(messages)
          return messages[1]?.content.includes('"history"') ? 'Resumen acumulado.' : 'Respuesta tras los bloques.'
        }
        destroy() {}
      }
      Object.defineProperty(window, 'LanguageModel', { value: FakeLanguageModel, configurable: true })
    })
    await page.route('**/api/llm/context', async route => {
      expect(chrome).toBe(false)
      const request = route.request().postDataJSON()
      expect(request.scope).toBe(scenario.scope)
      expect(request.model).toBe(scenario.scope === 'private' ? 'private-model' : 'test-model')
      measurements.push(JSON.stringify(request.messages))
      await route.fulfill({ json: { tokens: testTokens(request.messages), capacity, model: 'test-instance' } })
    })
    await page.route('**/api/llm/chat', async route => {
      expect(chrome).toBe(false)
      const request = route.request().postDataJSON()
      expect(request.scope).toBe(scenario.scope)
      expect(request.model).toBe('test-instance')
      prompts.push(request.messages)
      if (request.operation === 'story.compaction') {
        expect(testTokens(request.messages)).toBeLessThanOrEqual(capacity - 100)
        expect((await data.get<Story>('stories', story.id, scenario.scope)).contextSummary).toBeFalsy()
      }
      await route.fulfill({ json: { content: request.operation === 'story.compaction'
        ? 'Resumen acumulado.' : 'Respuesta tras los bloques.', finishReason: 'stop' } })
    })
    const story = await data.createStory({ characters: [], visualMode: scenario.visualMode, scope: scenario.scope })
    const original: Message[] = []
    for (let index = 0; index < 330; index += 1) {
      const raw = `Hecho ${index} 😀 ${'WORD258 '.repeat(100)}`
      original.push(await data.createMessage({ story, role: 'assistant', scope: scenario.scope,
        raw, segments: [{ type: 'narration', text: raw }] }))
    }
    if (scenario.scope === 'private') {
      await page.goto('/')
      await page.locator('main').press('Control+Alt+p')
      await expect(page.locator('html')).toHaveClass(/private-scope/)
      await page.locator(`a[href="/stories/${story.id}"]`).first().click()
    } else await page.goto(`/stories/${story.id}`)
    const composer = page.getByPlaceholder(/Escribe lo que haces/)
    await composer.fill('PENDIENTE258')
    const dialog = page.getByRole('dialog', { name: 'Compactar historia', exact: true })
    if (scenario.manual) {
      await page.getByRole('button', { name: 'Más opciones', exact: true }).click()
      await page.getByRole('button', { name: 'Compactar historia', exact: true }).click()
      await expect(dialog.getByRole('button', { name: 'Compactar', exact: true })).toBeEnabled()
      await dialog.getByRole('button', { name: 'Compactar', exact: true }).click()
      await expect(dialog.getByRole('button', { name: 'Compactar por bloques', exact: true })).toBeEnabled()
    } else {
      await page.getByRole('button', { name: 'Enviar', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Compactar por bloques', exact: true })).toBeVisible()
    }
    // Cada reintento crea una operación nueva; comprueba reutilización dentro de ella.
    measurements.length = 0
    if (chrome) await page.evaluate(() => {
      const state = window as unknown as ChromeState
      state.measurements = []
    })
    await page.getByRole('button', { name: 'Compactar por bloques', exact: true }).click()
    if (scenario.manual) await expect(dialog.getByTestId('manual-compaction-after')).toBeVisible()
    else await expect(page.getByTestId(scenario.visualMode ? 'visual-novel-frame' : 'story-scroller')
      .getByText('Respuesta tras los bloques.', { exact: true })).toBeVisible()
    const calls = chrome ? await page.evaluate(() => {
      const state = window as unknown as ChromeState
      return { measurements: state.measurements, prompts: state.prompts }
    }) : { measurements, prompts }
    const blocks = calls.prompts.map(blockBody).filter(body => body !== null)
    expect(blocks).toHaveLength(3)
    const received = blocks.flatMap(body => body.history)
    expect(received).toHaveLength(original.length)
    for (const [index, message] of original.entries()) {
      expect(received[index], `Mensaje ${index} completo y en orden`).toEqual({ role: message.role, content: message.raw })
    }
    expect(blocks.map(body => body.previousSummary)).toEqual(['', 'Resumen acumulado.', 'Resumen acumulado.'])
    expect(JSON.stringify(blocks)).not.toContain('PENDIENTE258')
    const blockMeasurements = calls.measurements.filter(key => blockBody(JSON.parse(key)))
    expect(blockMeasurements.length).toBeLessThanOrEqual(30)
    if (!chrome) expect(new Set(blockMeasurements).size).toBe(blockMeasurements.length)
    expect(calls.prompts.length).toBe(scenario.manual ? 3 : 4)
    expect(await data.get<Story>('stories', story.id, scenario.scope)).toMatchObject({
      contextSummary: 'Resumen acumulado.', contextSummaryThroughMessageId: original.at(-1)!.id
    })
    const saved = await data.list<Message>('messages', scenario.scope, { storyId: story.id })
    expect(saved.slice(0, 330)).toEqual(original)
    expect(saved).toHaveLength(scenario.manual ? 330 : 332)
    await expect(composer).toHaveValue(scenario.manual ? 'PENDIENTE258' : '')
    const traces = await data.list<LlmDebugTrace>('llmDebugTraces', scenario.scope, { storyId: story.id })
    const applied = traces.filter(trace => trace.request.compaction?.applied)
    expect(applied).toHaveLength(1)
    expect(applied[0]!.request.compaction!.blocks).toHaveLength(3)
    console.log(`${scenario.provider} ${scenario.manual ? 'manual' : 'continuación'}: ${blockMeasurements.length} mediciones de bloques, 3 resúmenes, 330 mensajes intactos`)
    if (scenario.manual && !chrome) await page.screenshot({ path: '.data/issue-258-compactacion.png' })
  })
}
