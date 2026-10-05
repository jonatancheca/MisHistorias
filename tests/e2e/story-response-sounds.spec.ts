import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import type { AppSettings, Character, Message } from '../../shared/types'
import { expect, PNG_BYTES, test, type TestDataFactory } from './fixtures'

type AudioState = { now: number | null; frequencies: number[] }
type AudioWindow = typeof globalThis & { __narratorAudio: AudioState }

async function prepareStory(page: Page, data: TestDataFactory, visualMode = true) {
  await data.patchSettings({
    mockMode: false, model: 'test-model', useChromeLlm: false, privateUseChromeLlm: null,
    narratorResponseSound: true, responseSpeed: 'instant', visualNovelManualAdvance: false,
    historyBudget: 100_000, swarmBaseUrl: ''
  })
  const character = await data.createCharacter()
  const story = await data.createStory({ characters: [character], visualMode })
  await page.route('**/api/llm/model-management', route =>
    route.fulfill({ json: { status: 'already-loaded', instanceId: 'test-model' } }))
  return story
}

async function advanceTime(page: Page, milliseconds: number) {
  await page.evaluate(value => { (globalThis as AudioWindow).__narratorAudio.now = value }, milliseconds)
}

async function tones(page: Page) {
  return page.evaluate(() => (globalThis as AudioWindow).__narratorAudio.frequencies)
}

async function send(page: Page) {
  await page.getByPlaceholder(/^Escribe lo que haces o dices/).fill('Abro la puerta.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state: AudioState = { now: 0, frequencies: [] }
    Object.defineProperty(globalThis, '__narratorAudio', { value: state })
    const now = performance.now.bind(performance)
    Object.defineProperty(performance, 'now', { value: () => state.now ?? now() })
    const createOscillator = AudioContext.prototype.createOscillator
    AudioContext.prototype.createOscillator = function () {
      const oscillator = createOscillator.call(this)
      const start = oscillator.start.bind(oscillator)
      oscillator.start = (at?: number) => {
        state.frequencies.push(oscillator.frequency.value)
        start(at)
      }
      return oscillator
    }
  })
})

for (const visualMode of [false, true]) {
  for (const elapsed of [1000, 1001]) {
    test(`${visualMode ? 'Novela Visual' : 'Chat'}: aviso solo al superar un segundo (${elapsed} ms)`, async ({ page, data }) => {
      const story = await prepareStory(page, data, visualMode)
      await page.route('**/api/llm/chat', async route => {
        await advanceTime(page, elapsed)
        await route.fulfill({ json: { content: 'La puerta se abre.', finishReason: 'stop' } })
      })
      await page.goto(`/stories/${story.id}`)
      await send(page)
      await expect.poll(async () => (await data.list<Message>('messages', 'normal', { storyId: story.id })).length).toBe(2)
      expect(await tones(page)).toEqual(elapsed > 1000 ? [660, 880] : [])
    })
  }
}

for (const outcome of ['success', 'error', 'empty'] as const) {
  test(`reintento vacío emite un único aviso definitivo: ${outcome}`, async ({ page, data }) => {
    const story = await prepareStory(page, data)
    let calls = 0
    await page.route('**/api/llm/chat', async route => {
      calls += 1
      await advanceTime(page, calls * 1100)
      if (calls === 1) return route.fulfill({ json: { content: '', finishReason: 'stop' } })
      expect(await tones(page)).toEqual([])
      await route.fulfill(outcome === 'error'
        ? { status: 502, json: { message: 'LLM no disponible.' } }
        : { json: { content: outcome === 'empty' ? '' : 'Respuesta recuperada.', finishReason: 'stop' } })
    })
    await page.goto(`/stories/${story.id}`)
    await send(page)
    await expect.poll(() => calls).toBe(2)
    await expect.poll(() => tones(page)).toEqual(outcome === 'success' ? [660, 880] : [330, 247])
    await expect(page.getByTestId('thinking-indicator')).toBeHidden()
    expect(calls).toBe(2)
    expect(await tones(page)).toEqual(outcome === 'success' ? [660, 880] : [330, 247])
  })
}

for (const action of ['Inicio', 'Continuar', 'Auto', 'Reintentar']) {
  test(`${action} reproduce el aviso al recibir texto`, async ({ page, data }) => {
    const story = await prepareStory(page, data)
    if (action === 'Continuar') {
      await data.createMessage({ story, role: 'assistant', raw: 'Una escena tranquila.', segments: [{ type: 'narration', text: 'Una escena tranquila.' }] })
    }
    let calls = 0
    await page.route('**/api/llm/chat', async route => {
      calls += 1
      if (action === 'Reintentar' && calls === 1) {
        return route.fulfill({ status: 502, json: { message: 'LLM no disponible.' } })
      }
      await advanceTime(page, 1100)
      return route.fulfill({ json: { content: 'Una nueva escena.', finishReason: 'stop' } })
    })
    await page.goto(`/stories/${story.id}`)
    if (action === 'Reintentar') {
      await send(page)
      await expect(page.getByTestId('visual-generation-feedback')).toBeVisible()
    }
    const button = action === 'Auto'
      ? page.getByTestId('auto-button')
      : action === 'Continuar'
        ? page.getByTestId('continue-button')
        : action === 'Inicio'
          ? page.getByRole('button', { name: /^Deja que la hist.ria empiece sola$/ }).filter({ visible: true })
          : page.getByRole('button', { name: action, exact: true }).filter({ visible: true })
    await button.click()
    await expect.poll(() => tones(page)).toEqual([660, 880])
  })
}

for (const action of ['Parar', 'salir']) {
  test(`${action} descarta respuesta tardía sin aviso`, async ({ page, data }) => {
    const story = await prepareStory(page, data)
    const gate = Promise.withResolvers<undefined>()
    let requested = false
    await page.route('**/api/llm/chat', async route => {
      requested = true
      await gate.promise
      await route.fulfill({ json: { content: 'Respuesta tardía.', finishReason: 'stop' } }).catch(() => {})
    })
    await page.goto(`/stories/${story.id}`)
    await send(page)
    await expect.poll(() => requested).toBe(true)
    await advanceTime(page, 1100)
    if (action === 'Parar') await page.getByRole('button', { name: 'Parar', exact: true }).filter({ visible: true }).click()
    else await page.getByRole('link', { name: 'Historias', exact: true }).click()
    gate.resolve(undefined)
    await expect(page.getByTestId('thinking-indicator')).toBeHidden()
    expect(await tones(page)).toEqual([])
    expect((await data.list<Message>('messages', 'normal', { storyId: story.id })).filter(message => message.role === 'assistant')).toHaveLength(0)
  })
}

test('avisa antes de esperar el avance manual de Novela Visual', async ({ page, data }) => {
  const story = await prepareStory(page, data)
  await data.patchSettings({ visualNovelManualAdvance: true })
  await page.route('**/api/llm/chat', async route => {
    await advanceTime(page, 1100)
    await route.fulfill({ json: { content: 'Narración: Primera escena.\nNarración: Segunda escena.', finishReason: 'stop' } })
  })
  await page.goto(`/stories/${story.id}`)
  await send(page)
  await expect.poll(() => tones(page)).toEqual([660, 880])
  await expect(page.getByTestId('visual-novel-next')).toBeVisible()
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
  await page.getByTestId('visual-novel-next').click()
  expect(await tones(page)).toEqual([660, 880])
})

test('avisa al recibir texto mientras las imágenes siguen pendientes', async ({ page, data }) => {
  const story = await prepareStory(page, data)
  const character = await data.get<Character>('characters', story.characterIds[0]!)
  await data.patchSettings({ swarmBaseUrl: 'http://localhost:7801' })
  await expect(await page.request.put(`/api/data/characters/${character.id}?scope=normal`, {
    data: { ...character, imageGenerationPreset: 'Retrato', imageGenerationModel: 'test-model' }
  })).toBeOK()
  await expect(await page.request.put(`/api/data/stories/${story.id}?scope=normal`, {
    data: { ...story, autoGenerateImages: true }
  })).toBeOK()
  const gate = Promise.withResolvers<undefined>()
  let imageRequested = false
  await page.route('**/api/swarm/generate', async route => {
    imageRequested = true
    await gate.promise
    await route.fulfill({ contentType: 'image/png', body: PNG_BYTES }).catch(() => {})
  })
  await page.route('**/api/llm/chat', async route => {
    await advanceTime(page, 1100)
    await route.fulfill({ json: {
      content: `Imagen ${character.name} [escena]: cinematic forest portrait\nNarración: Una nueva escena.`, finishReason: 'stop'
    } })
  })
  await page.goto(`/stories/${story.id}`)
  await send(page)
  await expect.poll(() => imageRequested).toBe(true)
  expect(await tones(page)).toEqual([660, 880])
  gate.resolve(undefined)
  await expect.poll(async () => (await data.list<Message>('messages', 'normal', { storyId: story.id })).length).toBe(2)
  expect(await tones(page)).toEqual([660, 880])
})

test('avisa con visibilidad oculta sin depender de las animaciones', async ({ page, data }) => {
  const story = await prepareStory(page, data)
  const gate = Promise.withResolvers<undefined>()
  let requested = false
  await page.route('**/api/llm/chat', async route => {
    requested = true
    await gate.promise
    await route.fulfill({ json: { content: 'La respuesta llegó en otra pestaña.', finishReason: 'stop' } })
  })
  await page.goto(`/stories/${story.id}`)
  await send(page)
  await expect.poll(() => requested).toBe(true)
  await advanceTime(page, 1100)
  // Playwright fuerza visibilidad; reproduce el estado oculto sin animaciones en la prueba portable.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    window.requestAnimationFrame = () => 0
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => page.evaluate(() => document.hidden)).toBe(true)
  gate.resolve(undefined)
  await expect.poll(() => tones(page)).toEqual([660, 880])
})

test('silenciar avisos conserva la respuesta y la preferencia al recargar y cambiar de ámbito', async ({ page, data }) => {
  const story = await prepareStory(page, data)
  await page.goto('/settings')
  const toggle = page.locator('#narratorResponseSound')
  await expect(toggle).toBeChecked()
  await toggle.uncheck()
  await expect.poll(async () => (await (await page.request.get('/api/settings')).json() as AppSettings).narratorResponseSound).toBe(false)
  await page.reload()
  await expect(toggle).not.toBeChecked()
  const privateTrigger = page.getByRole('button', { name: 'Activar modo privado' })
  await privateTrigger.click()
  await privateTrigger.click()
  await privateTrigger.click()
  await expect(toggle).not.toBeChecked()
  await page.locator('main').press('Control+Alt+p')
  await expect(page.locator('html')).not.toHaveClass(/private-scope/)
  await page.route('**/api/llm/chat', async route => {
    await advanceTime(page, 1100)
    await route.fulfill({ json: { content: 'Respuesta sin sonido.', finishReason: 'stop' } })
  })
  await page.goto(`/stories/${story.id}`)
  await send(page)
  await expect.poll(async () => (await data.list<Message>('messages', 'normal', { storyId: story.id })).length).toBe(2)
  expect(await tones(page)).toEqual([])
})

test('Ajustes muestra el control sin overflow en escritorio y móvil', async ({ page, data }) => {
  await data.patchSettings({ narratorResponseSound: true })
  await page.goto('/settings')
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.locator('#narratorResponseSound').scrollIntoViewIfNeeded()
    await expect(page.getByText('Avisos sonoros del narrador', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: resolve(`.data/issue-250-settings-${width}.png`) })
  }
})
