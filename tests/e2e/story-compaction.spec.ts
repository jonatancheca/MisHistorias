import type { Page } from '@playwright/test'
import type { LlmDebugTrace, Message, Story } from '../../shared/types'
import { expect, test, type TestDataFactory } from './fixtures'

interface ChatRequest {
  operation: string
  messages: Array<{ role: string; content: string }>
}

async function prepareStory(page: Page, data: TestDataFactory, visualMode = false) {
  await data.patchSettings({
    mockMode: false, model: 'test-model', useChromeLlm: false, privateUseChromeLlm: null,
    responseSpeed: 'instant', visualNovelManualAdvance: false, userName: 'Vera', historyBudget: 40_000,
    narrativePrompt: 'PROMPT_NARRATIVO: continúa la historia con los personajes.'
  })
  const character = await data.createCharacter()
  const background = await data.createBackground()
  const story = await data.createStory({ characters: [character], background, visualMode })
  const old = await data.createMessage({ story, role: 'assistant', raw: 'Hecho anterior. '.repeat(3500),
    segments: [{ type: 'narration', text: 'Hecho anterior. '.repeat(3500) }] })
  const composer = page.getByPlaceholder(/Escribe lo que haces/)
  return { story, old, composer }
}

async function saveStory(page: Page, story: Story) {
  await expect(await page.request.put(`/api/data/stories/${story.id}?scope=normal`, {
    data: story
  })).toBeOK()
}

test.describe('compactación previa del contexto', () => {
  test('bloquea 50.000 caracteres con límite 40.000 y conserva borrador y checkpoint', async ({ page, data }) => {
    const { story, old, composer } = await prepareStory(page, data)
    await saveStory(page, { ...story, contextSummary: 'Checkpoint válido.', contextSummaryThroughMessageId: old.id })
    const requests: ChatRequest[] = []
    await page.route('**/api/llm/chat', async (route) => {
      requests.push(route.request().postDataJSON())
      await route.fulfill({ json: { content: 'No debe llegar aquí.', finishReason: 'stop' } })
    })
    await page.goto(`/stories/${story.id}`)
    const text = 'A'.repeat(50_000)
    await composer.fill(text)
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('superan el límite de 40000 caracteres')
    await expect(composer).toHaveValue(text)
    await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled()
    expect(requests).toHaveLength(0)
    expect(await data.list<Message>('messages', 'normal', { storyId: story.id })).toHaveLength(1)
    expect(await data.get<Story>('stories', story.id)).toMatchObject({
      contextSummary: 'Checkpoint válido.', contextSummaryThroughMessageId: old.id
    })
  })

  for (const failure of ['excesivo', 'vacío', 'truncado', 'HTTP', 'checkpoint'] as const) {
    test(`resumen ${failure}: no avanza ni guarda mensaje nuevo; permite reenviar`, async ({ page, data }) => {
      const { story, old, composer } = await prepareStory(page, data, true)
      const checkpoint = { ...story, contextSummary: 'Checkpoint anterior.', contextSummaryThroughMessageId: old.id }
      await saveStory(page, checkpoint)
      const later = await data.createMessage({ story, role: 'assistant', raw: 'Pasado posterior. '.repeat(3500),
        segments: [{ type: 'narration', text: 'Pasado posterior. '.repeat(3500) }] })
      const requests: ChatRequest[] = []
      let fail = true
      await page.route(`**/api/data/stories/${story.id}?scope=normal`, async (route) => {
        const body = route.request().postData()
        if (failure === 'checkpoint' && fail && route.request().method() === 'PUT' && body?.includes('Resumen correcto.')) {
          return route.fulfill({ status: 500, json: { message: 'No se pudo guardar el checkpoint.' } })
        }
        await route.continue()
      })
      await page.route('**/api/llm/chat', async (route) => {
        const request = route.request().postDataJSON() as ChatRequest
        requests.push(request)
        if (request.operation === 'story.compaction') {
          expect(request.messages[0]!.content).not.toContain('PROMPT_NARRATIVO')
          expect(JSON.stringify(request.messages)).not.toContain('Intervención pendiente.')
          if (failure === 'HTTP' && fail) return route.fulfill({
            status: 502, json: { statusCode: 502, message: 'Compactador no disponible.' }
          })
          return route.fulfill({ json: {
            content: !fail || failure === 'checkpoint' ? 'Resumen correcto.'
              : failure === 'excesivo' ? 'X'.repeat(40_000) : failure === 'vacío' ? '' : 'Resumen cortado.',
            finishReason: failure === 'truncado' && fail ? 'length' : 'stop'
          } })
        }
        expect(request.messages.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(40_000)
        expect(await data.get<Story>('stories', story.id)).toMatchObject({
          contextSummary: 'Resumen correcto.', contextSummaryThroughMessageId: later.id
        })
        await route.fulfill({ json: { content: 'La historia avanza tras validar.', finishReason: 'stop' } })
      })
      await page.goto(`/stories/${story.id}`)
      await composer.fill('Intervención pendiente.')
      await page.getByRole('button', { name: 'Enviar', exact: true }).click()
      const feedback = page.getByTestId('visual-generation-feedback')
      await expect(feedback).toBeVisible()
      await expect(composer).toHaveValue('Intervención pendiente.')
      expect(requests.map((request) => request.operation)).toEqual(['story.compaction'])
      expect(await data.list<Message>('messages', 'normal', { storyId: story.id })).toHaveLength(2)
      expect(await data.get<Story>('stories', story.id)).toMatchObject({
        contextSummary: checkpoint.contextSummary, contextSummaryThroughMessageId: old.id
      })
      const traces = await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })
      expect(traces.at(-1)).toMatchObject({ status: 'error', request: { purpose: 'compaction' } })
      await page.setViewportSize({ width: 320, height: 760 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
      fail = false
      await page.getByRole('button', { name: 'Enviar', exact: true }).click()
      await expect(page.getByTestId('visual-novel-frame')).toContainText('La historia avanza tras validar.')
      await expect(composer).toHaveValue('')
      expect(requests.map((request) => request.operation)).toEqual(['story.compaction', 'story.compaction', 'story.chat'])
      const messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
      expect(messages.map((message) => message.role)).toEqual(['assistant', 'assistant', 'user', 'assistant'])
      await page.reload()
      expect(await data.get<Story>('stories', story.id)).toMatchObject({
        contextSummary: 'Resumen correcto.', contextSummaryThroughMessageId: later.id
      })
    })
  }

  for (const mode of ['continue', 'auto', 'resend', 'regenerate'] as const) {
    test(`${mode}: valida antes del narrador y conserva usuario pendiente`, async ({ page, data }) => {
      const { story } = await prepareStory(page, data)
      await data.createMessage({ story, role: 'user', raw: 'TEXTO_PENDIENTE_INTACTO' })
      if (mode === 'regenerate') {
        await data.createMessage({ story, role: 'assistant', raw: 'Respuesta para regenerar.',
          segments: [{ type: 'narration', text: 'Respuesta para regenerar.' }] })
      }
      const operations: string[] = []
      await page.route('**/api/llm/chat', async (route) => {
        const request = route.request().postDataJSON() as ChatRequest
        operations.push(request.operation)
        if (request.operation === 'story.compaction') {
          expect(JSON.stringify(request.messages)).not.toContain('TEXTO_PENDIENTE_INTACTO')
          return route.fulfill({ json: { content: 'Resumen breve.', finishReason: 'stop' } })
        }
        expect(JSON.stringify(request.messages)).toContain('TEXTO_PENDIENTE_INTACTO')
        expect(request.messages.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(40_000)
        await route.fulfill({ json: { content: 'Respuesta dentro del límite.', finishReason: 'stop' } })
      })
      await page.goto(`/stories/${story.id}`)
      if (mode === 'resend') {
        await page.getByRole('button', { name: 'Reenviar este mensaje' }).click()
        await page.getByRole('alertdialog').getByRole('button', { name: 'Reenviar', exact: true }).click()
      } else if (mode === 'regenerate') {
        await page.getByRole('button', { name: 'Regenerar desde este mensaje' }).last().click()
        await page.getByRole('alertdialog').getByRole('button', { name: 'Regenerar', exact: true }).click()
      } else await page.getByTestId(mode === 'continue' ? 'continue-button' : 'auto-button').click()
      await expect(page.getByText('Respuesta dentro del límite.', { exact: true })).toBeVisible()
      expect(operations).toEqual(['story.compaction', 'story.chat'])
    })
  }

  test('recompacta checkpoint sin historial nuevo y 0 deja enviar sin compactar', async ({ page, data }) => {
    const { story, old, composer } = await prepareStory(page, data)
    await saveStory(page, { ...story, contextSummary: 'Resumen antiguo extenso. '.repeat(2500), contextSummaryThroughMessageId: old.id })
    const requests: ChatRequest[] = []
    await page.route('**/api/llm/chat', async (route) => {
      const request = route.request().postDataJSON() as ChatRequest
      requests.push(request)
      if (request.operation === 'story.compaction') {
        expect(JSON.parse(request.messages[1]!.content).history).toEqual([])
        return route.fulfill({ json: { content: 'Checkpoint reducido.', finishReason: 'stop' } })
      }
      await route.fulfill({ json: { content: 'Respuesta breve.', finishReason: 'stop' } })
    })
    await page.goto(`/stories/${story.id}`)
    await composer.fill('Sigo.')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(page.getByText('Respuesta breve.', { exact: true })).toBeVisible()
    expect(requests.map((request) => request.operation)).toEqual(['story.compaction', 'story.chat'])
    await data.patchSettings({ historyBudget: 0 })
    await page.reload()
    await composer.fill('A'.repeat(50_000))
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect.poll(() => requests.length).toBe(3)
    expect(requests[2]!.operation).toBe('story.chat')
    expect(requests[2]!.messages.reduce((total, message) => total + message.content.length, 0)).toBeGreaterThan(50_000)
  })

  test('cancelar compactación conserva checkpoint, mensajes y borrador', async ({ page, data }) => {
    const { story, composer } = await prepareStory(page, data, true)
    const gate = Promise.withResolvers<undefined>()
    let calls = 0
    await page.route('**/api/llm/chat', async (route) => {
      calls += 1
      await gate.promise
      await route.fulfill({ json: { content: 'Resumen cancelado.', finishReason: 'stop' } }).catch(() => {})
    })
    await page.setViewportSize({ width: 390, height: 760 })
    await page.goto(`/stories/${story.id}`)
    await composer.fill('Borrador que debe quedarse.')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(page.getByTestId('compacting-indicator')).toBeVisible()
    await expect(page.getByTestId('compacting-indicator')).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
    await page.getByRole('button', { name: 'Parar', exact: true }).last().click()
    gate.resolve(undefined)
    await expect(page.getByTestId('compacting-indicator')).toBeHidden()
    await expect(composer).toHaveValue('Borrador que debe quedarse.')
    expect(calls).toBe(1)
    expect((await data.get<Story>('stories', story.id)).contextSummary).toBeFalsy()
    expect(await data.list<Message>('messages', 'normal', { storyId: story.id })).toHaveLength(1)
  })

  test('reintento narrativo vuelve a validar el contexto al reducir el límite sin duplicar usuario', async ({ page, data }) => {
    const { story, composer } = await prepareStory(page, data, true)
    const operations: string[] = []
    let chatCalls = 0
    let compactionCalls = 0
    await page.route('**/api/llm/chat', async (route) => {
      const request = route.request().postDataJSON() as ChatRequest
      operations.push(request.operation)
      if (request.operation === 'story.compaction') {
        compactionCalls += 1
        return route.fulfill({ json: {
          content: compactionCalls === 1 ? 'Resumen amplio. '.repeat(1800) : 'Resumen reducido.', finishReason: 'stop'
        } })
      }
      chatCalls += 1
      if (chatCalls === 1) return route.fulfill({ status: 502, json: { statusCode: 502, message: 'Narrador no disponible.' } })
      expect(request.messages.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(8000)
      expect(JSON.stringify(request.messages)).toContain('Intervención sin duplicar.')
      await route.fulfill({ json: { content: 'Respuesta recuperada.', finishReason: 'stop' } })
    })
    await page.goto(`/stories/${story.id}`)
    await composer.fill('Intervención sin duplicar.')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(page.getByTestId('visual-generation-feedback')).toContainText('Narrador no disponible.')
    await data.patchSettings({ historyBudget: 8000 })
    await page.reload()
    await page.getByTestId('visual-generation-feedback').getByRole('button', { name: 'Reintentar', exact: true }).click()
    await expect(page.getByTestId('visual-novel-frame')).toContainText('Respuesta recuperada.')
    expect(operations).toEqual(['story.compaction', 'story.chat', 'story.compaction', 'story.chat'])
    const messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(messages).toHaveLength(3)
  })

  test('Chrome usa compactación separada y acepta contexto de exactamente 40.000 caracteres', async ({ page, data }) => {
    const { story, composer } = await prepareStory(page, data)
    await data.patchSettings({ useChromeLlm: true, privateUseChromeLlm: null, model: '' })
    await page.addInitScript(() => {
      const prompts: Array<Array<{ role: string; content: string }>> = []
      Object.defineProperty(globalThis, '__compactionPrompts', { value: prompts })
      class FakeLanguageModel {
        static async availability() { return 'available' }
        static async create() { return new FakeLanguageModel() }
        async prompt(messages: Array<{ role: string; content: string }>) {
          prompts.push(messages)
          if (messages[0]!.content.startsWith('Resume el historial')) {
            const budget = Number(messages[0]!.content.match(/como máximo (\d+) caracteres/)![1])
            return 'R'.repeat(budget)
          }
          return 'Respuesta local dentro del límite.'
        }
        destroy() {}
      }
      Object.defineProperty(globalThis, 'LanguageModel', { configurable: true, value: FakeLanguageModel })
    })
    let lmStudioCalls = 0
    await page.route('**/api/llm/chat', async (route) => {
      lmStudioCalls += 1
      await route.fulfill({ status: 500 })
    })
    await page.goto(`/stories/${story.id}`)
    await composer.fill('Mensaje nuevo para Chrome.')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(page.getByText('Respuesta local dentro del límite.', { exact: true })).toBeVisible()
    const prompts = await page.evaluate(() => (globalThis as typeof globalThis & {
      __compactionPrompts: Array<Array<{ role: string; content: string }>>
    }).__compactionPrompts)
    expect(prompts).toHaveLength(2)
    expect(JSON.stringify(prompts[0])).not.toContain('Mensaje nuevo para Chrome.')
    expect(prompts[1]!.reduce((total, message) => total + message.content.length, 0)).toBe(40_000)
    expect(lmStudioCalls).toBe(0)
  })
})
