import type { Page } from '@playwright/test'
import type { CharacterImage, LlmDebugTrace, Message } from '../../shared/types'
import { expect, PNG_BYTES, test, type TestDataFactory } from './fixtures'

async function prepareStory(page: Page, data: TestDataFactory, visualMode = true) {
  await data.patchSettings({
    mockMode: false, model: 'test-model', useChromeLlm: false, privateUseChromeLlm: null,
    responseSpeed: 'instant', visualNovelManualAdvance: false, userName: 'Vera', historyBudget: 100_000
  })
  const character = await data.createCharacter({ imageGenerationPreset: 'Retrato', imageGenerationModel: 'model-test' })
  const background = await data.createBackground()
  const story = await data.createStory({ characters: [character], background, visualMode })
  await page.route('**/api/llm/model-management', (route) =>
    route.fulfill({ json: { status: 'already-loaded', instanceId: 'test-model' } }))
  return { story, character }
}

for (const visualMode of [false, true]) {
  for (const finishReason of ['stop', 'length']) {
    test(`vacío ${finishReason} se reintenta una vez en ${visualMode ? 'Novela Visual' : 'Chat'} con misma petición`, async ({ page, data }) => {
      const { story } = await prepareStory(page, data, visualMode)
      const gate = Promise.withResolvers<undefined>()
      const requests: unknown[] = []
      await page.route('**/api/llm/chat', async (route) => {
        requests.push(route.request().postDataJSON())
        if (requests.length === 1) return route.fulfill({ json: { content: '  ', finishReason } })
        await gate.promise
        await route.fulfill({ json: { content: 'La puerta se abre.', finishReason: 'stop' } })
      })
      await page.goto(`/stories/${story.id}`)
      await page.getByPlaceholder(/^Escribe lo que haces o dices/).fill('Abro la puerta.')
      await page.getByRole('button', { name: 'Enviar', exact: true }).click()
      const indicator = page.getByTestId('thinking-indicator')
      await expect(indicator).toHaveText('Creando historia… (reintentando)')
      expect(requests).toHaveLength(2)
      expect(requests[1]).toEqual(requests[0])
      await expect(page.getByText('El modelo no devolvió contenido visible.', { exact: true })).toHaveCount(0)
      if (finishReason === 'stop') {
        for (const width of [320, 390]) {
          await page.setViewportSize({ width, height: 900 })
          await expect(indicator).toBeInViewport()
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
        }
      }
      gate.resolve(undefined)
      await expect(indicator).toBeHidden()
      await expect.poll(async () => (await data.list<Message>('messages', 'normal', { storyId: story.id })).length).toBe(2)
      const messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
      expect(messages.map((message) => message.role)).toEqual(['user', 'assistant'])
      expect(messages[1]!.raw).toBe('La puerta se abre.')
      const traces = await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })
      expect(traces).toHaveLength(2)
      expect(traces[0]!.request.generation).toMatchObject({ dismissed: true, automaticallyRetried: true })
      expect(traces[1]!.responseMessageId).toBe(messages[1]!.id)
      await page.reload()
      await expect(page.getByText('El modelo no devolvió contenido visible.', { exact: true })).toHaveCount(0)
      expect(requests).toHaveLength(2)
    })
  }
}

for (const mode of ['normal', 'auto'] as const) {
  test(`Parar cancela segundo intento de ${mode} sin revivir el vacío`, async ({ page, data }) => {
    const { story } = await prepareStory(page, data)
    const gate = Promise.withResolvers<undefined>()
    let calls = 0
    await page.route('**/api/llm/chat', async (route) => {
      calls += 1
      if (calls === 1) return route.fulfill({ json: { content: '', finishReason: 'stop' } })
      await gate.promise
      await route.fulfill({ json: { content: 'Respuesta tardía.', finishReason: 'stop' } }).catch(() => {})
    })
    await page.goto(`/stories/${story.id}`)
    if (mode === 'normal') {
      await page.getByPlaceholder(/^Escribe lo que haces o dices/).fill('Espero.')
      await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    } else {
      await page.getByTestId('auto-button').click()
    }
    await expect(page.getByTestId('thinking-indicator')).toHaveText('Creando historia… (reintentando)')
    await page.getByRole('button', { name: 'Parar', exact: true }).filter({ visible: true }).click()
    gate.resolve(undefined)
    await expect(page.getByTestId('thinking-indicator')).toBeHidden()
    await expect(page.getByTestId('visual-generation-feedback')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled()
    const messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
    expect(messages.map((message) => message.role)).toEqual(mode === 'normal' ? ['user'] : [])
    await page.reload()
    await expect(page.getByTestId('visual-generation-feedback')).toBeHidden()
    expect(calls).toBe(2)
  })
}

test('Auto agota dos vacíos y conserva el reintento manual', async ({ page, data }) => {
  const { story } = await prepareStory(page, data)
  let calls = 0
  await page.route('**/api/llm/chat', async (route) => {
    calls += 1
    await route.fulfill({ json: { content: '', finishReason: 'stop' } })
  })
  await page.goto(`/stories/${story.id}`)
  await page.getByTestId('auto-button').click()
  await expect(page.getByTestId('visual-generation-feedback')).toContainText('El modelo no devolvió contenido visible.')
  await expect(page.getByTestId('thinking-indicator')).toBeHidden()
  await expect(page.getByTestId('auto-button')).toBeEnabled()
  expect(calls).toBe(2)
  expect(await data.list<Message>('messages', 'normal', { storyId: story.id })).toHaveLength(0)
})

test('directivas del primer resultado vacío no generan imágenes duplicadas', async ({ page, data }) => {
  const { story, character } = await prepareStory(page, data)
  await data.patchSettings({ swarmBaseUrl: 'http://localhost:7801' })
  await expect(await page.request.put(`/api/data/stories/${story.id}?scope=normal`, {
    data: { ...story, autoGenerateImages: true }
  })).toBeOK()
  const gate = Promise.withResolvers<undefined>()
  let calls = 0
  const imageRequests: Array<Record<string, unknown>> = []
  await page.route('**/api/llm/chat', async (route) => {
    calls += 1
    if (calls === 1) return route.fulfill({ json: {
      content: `Imagen ${character.name} [primera]: discarded forest portrait`, finishReason: 'stop'
    } })
    await gate.promise
    await route.fulfill({ json: {
      content: `Imagen ${character.name} [final]: final tavern portrait\nNarración: Una escena nueva.`, finishReason: 'stop'
    } })
  })
  await page.route('**/api/swarm/generate', async (route) => {
    imageRequests.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({ contentType: 'image/png', body: PNG_BYTES })
  })
  await page.goto(`/stories/${story.id}`)
  await page.getByPlaceholder(/^Escribe lo que haces o dices/).fill('Continúa.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByTestId('thinking-indicator')).toHaveText('Creando historia… (reintentando)')
  expect(imageRequests).toHaveLength(0)
  expect(await data.list<CharacterImage>('images', 'normal', { characterId: character.id })).toHaveLength(0)
  gate.resolve(undefined)
  await expect.poll(async () => (await data.list<CharacterImage>('images', 'normal', { characterId: character.id })).length).toBe(3)
  expect(imageRequests).toHaveLength(3)
  for (const request of imageRequests) {
    expect(JSON.stringify(request)).toContain('final tavern portrait')
    expect(JSON.stringify(request)).not.toContain('discarded forest portrait')
  }
  expect(calls).toBe(2)
  const messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
  expect(messages.map((message) => message.role)).toEqual(['user', 'assistant'])
  expect(messages[1]!.raw).toContain('Una escena nueva.')
})

test('Chrome reintenta vacío con el mismo prompt sin usar LM Studio', async ({ page, data }) => {
  const { story } = await prepareStory(page, data)
  await data.patchSettings({ useChromeLlm: true, privateUseChromeLlm: null, model: '' })
  await page.addInitScript(() => {
    type ChromeState = { prompts: unknown[]; destroyed: number }
    const state: ChromeState = { prompts: [], destroyed: 0 }
    Object.defineProperty(globalThis, '__retryChrome', { value: state })
    class FakeLanguageModel {
      static async availability() { return 'available' }
      static async create() { return new FakeLanguageModel() }
      async prompt(messages: unknown[]) {
        state.prompts.push(messages)
        return state.prompts.length === 1 ? '' : 'Respuesta local recuperada.'
      }
      destroy() { state.destroyed += 1 }
    }
    Object.defineProperty(globalThis, 'LanguageModel', { configurable: true, value: FakeLanguageModel })
  })
  let lmStudioCalls = 0
  await page.route('**/api/llm/chat', (route) => {
    lmStudioCalls += 1
    return route.fulfill({ status: 500 })
  })
  await page.goto(`/stories/${story.id}`)
  await page.getByPlaceholder(/^Escribe lo que haces o dices/).fill('Usa Chrome.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect.poll(async () => (await data.list<Message>('messages', 'normal', { storyId: story.id })).length).toBe(2)
  const state = await page.evaluate(() => (globalThis as typeof globalThis & {
    __retryChrome: { prompts: unknown[]; destroyed: number }
  }).__retryChrome)
  expect(state.prompts).toHaveLength(2)
  expect(state.prompts[1]).toEqual(state.prompts[0])
  expect(state.destroyed).toBe(2)
  expect(lmStudioCalls).toBe(0)
  const traces = await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })
  expect(traces).toHaveLength(2)
  expect(traces.every((trace) => trace.request.provider === 'chrome')).toBe(true)
})
