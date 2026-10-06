import type { Page } from '@playwright/test'
import type { LlmDebugTrace, Message, Story } from '../../shared/types'
import { test, expect, type TestDataFactory } from './fixtures'
import { startFakeLmStudio } from '../helpers/fakeLmStudio'

interface CompactionRequest {
  scope: string
  model: string
  operation: string
  maxTokens: number
  messages: Array<{ role: string; content: string }>
}

test.beforeEach(async ({ page, data }) => {
  await data.patchSettings({ mockMode: false, model: 'test-model', useChromeLlm: false,
    privateUseChromeLlm: null, privateLlmSettingsEnabled: false, historyBudget: 100000,
    contextTokenBudget: 0, contextUnit: 'characters', maxTokens: 100, responseSpeed: 'instant',
    narrativePrompt: 'Narra la historia.', compactionPrompt: null })
  await page.route('**/api/llm/model-status?*', route => route.fulfill({ json: { loaded: true } }))
  await page.route('**/api/llm/context', route => {
    const request = route.request().postDataJSON() as CompactionRequest
    const tokens = request.messages.reduce((total, message) => total + Math.ceil(message.content.length / 4), 0)
    return route.fulfill({ json: { tokens, capacity: 1900, model: 'test-instance' } })
  })
})

async function prepare(page: Page, data: TestDataFactory, visualMode = false, scope: 'normal' | 'private' = 'normal') {
  if (scope === 'private') await data.patchSettings({ privateLlmSettingsEnabled: true, privateModel: 'private-model',
    privateHistoryBudget: 100000, privateContextTokenBudget: 0, privateContextUnit: 'characters', privateMaxTokens: 100 })
  const story = await data.createStory({ characters: [], visualMode, scope })
  const seed = await data.createMessage({ story, scope, role: 'assistant', raw: 'Hecho ya resumido.' })
  const old = await data.createMessage({ story, scope, role: 'assistant', raw: 'Hechos de la historia. '.repeat(400) })
  const pending = await data.createMessage({ story, scope, role: 'user', raw: 'PENDIENTE_SIN_RESPUESTA' })
  if (scope === 'private') {
    await page.goto('/')
    await page.locator('main').press('Control+Alt+p')
    await expect(page.locator('html')).toHaveClass(/private-scope/)
    await page.locator(`a[href="/stories/${story.id}"]`).first().click()
  } else await page.goto(`/stories/${story.id}`)
  await page.getByPlaceholder(/Escribe lo que haces/).fill('BORRADOR_SIN_ENVIAR')
  return { story, seed, old, pending }
}

async function offerAlternatives(page: Page) {
  await page.getByRole('button', { name: 'Más opciones', exact: true }).click()
  await page.getByRole('button', { name: 'Compactar historia', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Compactar historia', exact: true })
  await dialog.getByRole('button', { name: 'Compactar', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('no cabe en una única petición')
  await expect(dialog.getByRole('button', { name: 'Compactar por bloques', exact: true })).toBeEnabled()
  await expect(dialog.getByRole('button', { name: 'Compactar igualmente', exact: true })).toBeEnabled()
  await expect(dialog.getByText('Al compactar igualmente, la petición puede superar la capacidad del modelo y fallar.')).toBeVisible()
  return dialog
}

for (const scope of ['normal', 'private'] as const) {
  for (const visualMode of [false, true]) {
    test(`compactar igualmente envía historial completo sin continuar (${scope}, ${visualMode ? 'Novela' : 'Chat'})`, async ({ page, data }) => {
      const { story, seed, old, pending } = await prepare(page, data, visualMode, scope)
      const requests: CompactionRequest[] = []
      await page.route('**/api/llm/chat', route => {
        const request = route.request().postDataJSON() as CompactionRequest
        requests.push(request)
        expect(request).toMatchObject({ scope, model: 'test-instance', operation: 'story.compaction', maxTokens: 100 })
        expect(JSON.parse(request.messages[1]!.content).history).toEqual([
          { role: 'assistant', content: seed.raw }, { role: 'assistant', content: old.raw }
        ])
        expect(JSON.stringify(request.messages)).not.toMatch(/PENDIENTE_SIN_RESPUESTA|BORRADOR_SIN_ENVIAR/)
        return route.fulfill({ json: { content: 'Resumen completo y breve.', finishReason: 'stop' } })
      })
      const dialog = await offerAlternatives(page)
      expect(requests).toHaveLength(0)
      if (scope === 'normal') {
        for (const width of [320, 390, 640, 768, 1280]) {
          await page.setViewportSize({ width, height: 900 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
          for (const name of ['Compactar por bloques', 'Compactar igualmente']) {
            const button = dialog.getByRole('button', { name, exact: true })
            await expect(button).toBeVisible()
            const bounds = await button.boundingBox()
            expect(bounds!.x).toBeGreaterThanOrEqual(0)
            expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
          }
          await page.screenshot({ path: `.data/issue-257-${visualMode ? 'novela' : 'chat'}-${width}.png` })
        }
      }
      await dialog.getByRole('button', { name: 'Compactar igualmente', exact: true }).click()
      await expect(dialog.getByTestId('manual-compaction-after')).toBeVisible()
      expect(requests).toHaveLength(1)
      expect(await data.get<Story>('stories', story.id, scope)).toMatchObject({
        contextSummary: 'Resumen completo y breve.', contextSummaryThroughMessageId: old.id
      })
      expect((await data.list<Message>('messages', scope, { storyId: story.id })).map(message => message.id)).toEqual([seed.id, old.id, pending.id])
      const trace = (await data.list<LlmDebugTrace>('llmDebugTraces', scope, { storyId: story.id })).at(-1)
      expect(trace).toMatchObject({ status: 'success', request: { purpose: 'compaction', compaction: { applied: true } } })
      expect(trace!.request.contextUsage!.count).toBeGreaterThan(trace!.request.contextUsage!.effectiveLimit)
      expect(trace!.request.compaction!.afterUsage!.count).toBeLessThanOrEqual(trace!.request.compaction!.afterUsage!.effectiveLimit)
      await dialog.getByRole('button', { name: 'Cerrar diálogo' }).click()
      await expect(page.getByPlaceholder(/Escribe lo que haces/)).toHaveValue('BORRADOR_SIN_ENVIAR')
    })
  }
}

for (const failure of ['proveedor', 'vacío', 'truncado', 'sin reducción', 'límite'] as const) {
  test(`compactar igualmente: fallo ${failure} conserva checkpoint y alternativas`, async ({ page, data }) => {
    const { story, seed, old, pending } = await prepare(page, data)
    const previous = 'Checkpoint anterior.'
    await expect(await page.request.put(`/api/data/stories/${story.id}?scope=normal`, { data: {
      ...story, contextSummary: previous, contextSummaryThroughMessageId: seed.id
    } })).toBeOK()
    await page.reload()
    await page.getByPlaceholder(/Escribe lo que haces/).fill('BORRADOR_SIN_ENVIAR')
    let fail = true
    let calls = 0
    await page.route('**/api/llm/chat', route => {
      calls += 1
      expect(route.request().postDataJSON().operation).toBe('story.compaction')
      if (fail && failure === 'proveedor') return route.fulfill({ status: 502, json: { message: 'El proveedor rechazó la petición.' } })
      return route.fulfill({ json: {
        content: !fail ? 'Resumen breve.' : failure === 'vacío' ? ''
          : failure === 'sin reducción' ? 'R'.repeat(16000) : failure === 'límite' ? 'R'.repeat(6000) : 'Resumen truncado.',
        finishReason: fail && failure === 'truncado' ? 'length' : 'stop'
      } })
    })
    const dialog = await offerAlternatives(page)
    expect(calls).toBe(0)
    await dialog.getByRole('button', { name: 'Compactar igualmente', exact: true }).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    expect(calls).toBe(1)
    expect(await data.get<Story>('stories', story.id)).toMatchObject({
      contextSummary: previous, contextSummaryThroughMessageId: seed.id
    })
    expect((await data.list<Message>('messages', 'normal', { storyId: story.id })).map(message => message.id)).toEqual([seed.id, old.id, pending.id])
    expect((await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })).at(-1))
      .toMatchObject({ status: 'error', request: { compaction: { applied: false } } })
    for (const name of ['Compactar por bloques', 'Compactar igualmente']) {
      await expect(dialog.getByRole('button', { name, exact: true })).toBeEnabled()
    }
    fail = false
    await dialog.getByRole('button', { name: failure === 'proveedor' ? 'Compactar por bloques' : 'Compactar igualmente', exact: true }).click()
    await expect(dialog.getByTestId('manual-compaction-after')).toBeVisible()
    expect((await data.get<Story>('stories', story.id)).contextSummary).toBe('Resumen breve.')
    await dialog.getByRole('button', { name: 'Cerrar diálogo' }).click()
    await expect(page.getByPlaceholder(/Escribe lo que haces/)).toHaveValue('BORRADOR_SIN_ENVIAR')
  })
}

test('cancelar compactar igualmente conserva datos y permite actualizar medidas', async ({ page, data }) => {
  const { story, seed, old, pending } = await prepare(page, data)
  let release: (() => void) | undefined
  const waiting = new Promise<void>(resolve => { release = resolve })
  let requested = false
  await page.route('**/api/llm/chat', async route => {
    requested = true
    await waiting
    await route.fulfill({ json: { content: 'Resumen tardío.', finishReason: 'stop' } }).catch(() => undefined)
  })
  const dialog = await offerAlternatives(page)
  await dialog.getByRole('button', { name: 'Compactar igualmente', exact: true }).click()
  await expect.poll(() => requested).toBe(true)
  await dialog.getByRole('button', { name: 'Cancelar compactación' }).click()
  await expect(dialog.getByRole('alert')).toContainText('cancelada')
  await expect(dialog.getByRole('button', { name: 'Compactar igualmente', exact: true })).toBeEnabled()
  release!()
  await dialog.getByRole('button', { name: 'Actualizar medidas', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Compactar', exact: true })).toBeEnabled()
  await expect(dialog.getByRole('button', { name: 'Compactar igualmente', exact: true })).toHaveCount(0)
  expect((await data.get<Story>('stories', story.id)).contextSummary).toBeFalsy()
  expect((await data.list<Message>('messages', 'normal', { storyId: story.id })).map(message => message.id)).toEqual([seed.id, old.id, pending.id])
  await dialog.getByRole('button', { name: 'Cerrar diálogo' }).click()
  await expect(page.getByPlaceholder(/Escribe lo que haces/)).toHaveValue('BORRADOR_SIN_ENVIAR')
})

test('Chrome compactar igualmente llega al proveedor pese a la cuota medida', async ({ page, data }) => {
  await data.patchSettings({ useChromeLlm: true })
  await page.addInitScript(() => {
    const state = window as unknown as { compactionPrompts: unknown[] }
    state.compactionPrompts = []
    class FakeLanguageModel {
      contextWindow = 1900
      contextUsage = 0
      static async availability() { return 'available' }
      static async create() { return new FakeLanguageModel() }
      async measureContextUsage(messages: unknown) { return Math.ceil(JSON.stringify(messages).length / 4) }
      async prompt(messages: unknown) { state.compactionPrompts.push(messages); return 'Resumen Chrome.' }
      destroy() {}
    }
    Object.defineProperty(window, 'LanguageModel', { value: FakeLanguageModel, configurable: true })
  })
  const { story, old } = await prepare(page, data)
  let lmStudioCalls = 0
  await page.route('**/api/llm/chat', route => { lmStudioCalls += 1; return route.fulfill({ status: 500 }) })
  await page.route('**/api/llm/context', route => { lmStudioCalls += 1; return route.fulfill({ status: 500 }) })
  const dialog = await offerAlternatives(page)
  expect(await page.evaluate(() => (window as unknown as { compactionPrompts: unknown[] }).compactionPrompts)).toHaveLength(0)
  await dialog.getByRole('button', { name: 'Compactar igualmente', exact: true }).click()
  await expect(dialog.getByTestId('manual-compaction-after')).toBeVisible()
  const prompts = await page.evaluate(() => (window as unknown as { compactionPrompts: unknown[] }).compactionPrompts)
  expect(prompts).toHaveLength(1)
  expect(JSON.stringify(prompts)).toContain(old.raw)
  expect(lmStudioCalls).toBe(0)
  expect((await data.get<Story>('stories', story.id)).contextSummary).toBe('Resumen Chrome.')
})

for (const inputTokens of [4000, 6000]) {
  test(`compactar igualmente con respuesta Auto respeta espacio real (${inputTokens} tokens de entrada)`, async ({ page, data }) => {
    const server = await startFakeLmStudio({ tokens: inputTokens, capacity: 6000 })
    const previous = await (await page.request.get('/api/settings')).json()
    try {
      await data.patchSettings({ baseUrl: server.baseUrl, apiKey: '', maxTokens: 'auto' })
      await page.route('**/api/llm/context', route => {
        const request = route.request().postDataJSON() as CompactionRequest
        const tokens = request.messages.reduce((total, message) => total + Math.ceil(message.content.length / 4), 0)
        return route.fulfill({ json: { tokens, capacity: 6000, model: 'loaded-instance' } })
      })
      const { story, old } = await prepare(page, data)
      const dialog = await offerAlternatives(page)
      expect(server.chatRequests).toHaveLength(0)
      await dialog.getByRole('button', { name: 'Compactar igualmente', exact: true }).click()
      if (inputTokens === 4000) {
        await expect(dialog.getByTestId('manual-compaction-after')).toBeVisible()
        expect(server.chatRequests).toHaveLength(1)
        expect(server.chatRequests[0]).toMatchObject({ max_tokens: 2000, model: 'loaded-instance' })
        expect(JSON.stringify(server.chatRequests[0]!.messages)).toContain(old.raw)
        const trace = (await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })).at(-1)!
        expect(trace.request.max_tokens).toBe(2000)
        expect(trace.request.compaction!.applied).toBe(true)
      } else {
        await expect(dialog.getByRole('alert')).toContainText('no deja espacio para la respuesta')
        expect(server.chatRequests).toHaveLength(0)
        expect((await data.get<Story>('stories', story.id)).contextSummary).toBeFalsy()
        await expect(dialog.getByRole('button', { name: 'Compactar por bloques', exact: true })).toBeEnabled()
        await expect(dialog.getByRole('button', { name: 'Compactar igualmente', exact: true })).toBeEnabled()
      }
    } finally {
      await data.patchSettings({ baseUrl: previous.baseUrl })
      await server.close()
    }
  })
}
