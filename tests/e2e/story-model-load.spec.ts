import { createServer } from 'node:http'
import type { APIRequestContext } from '@playwright/test'
import type { LlmDebugTrace, Message, Story } from '../../shared/types'
import { expect, test, type DataScope, type TestDataFactory } from './fixtures'

async function storyWithDebug(data: TestDataFactory, request: APIRequestContext, visualMode = false) {
  const story = await data.createStory({ characters: [], visualMode })
  let lastMessage: Message | null = null
  for (let index = 0; index < 2; index++) {
    lastMessage = await data.createMessage({
      story, role: 'assistant', raw: `Escena ${index + 1}.`,
      segments: [{ type: 'narration', text: `Escena ${index + 1}.` }]
    })
    const trace: LlmDebugTrace = {
      id: data.unique('trace'), storyId: story.id, responseMessageId: lastMessage.id,
      status: 'success', createdAt: lastMessage.createdAt,
      request: { provider: 'lmstudio', model: 'modelo-historia', messages: [], temperature: 0.7, max_tokens: 100, stream: false },
      response: { content: lastMessage.raw, finishReason: 'stop' }
    }
    await expect(await request.put(`/api/data/llmDebugTraces/${trace.id}?scope=normal`, { data: trace })).toBeOK()
  }
  return { story, lastMessage: lastMessage! }
}

test.beforeEach(async ({ data }) => {
  await data.patchSettings({
    mockMode: false, useChromeLlm: false, model: 'modelo-historia',
    privateLlmSettingsEnabled: false, privateUseChromeLlm: null,
    responseSpeed: 'instant', visualNovelManualAdvance: false
  })
})

for (const visualMode of [false, true]) {
  test(`botón único de carga accesible, carga sin enviar y conserva borrador; visual=${visualMode}`, async ({ page, data }) => {
    const { story, lastMessage } = await storyWithDebug(data, page.request, visualMode)
    if (visualMode) await data.createMessage({ story, role: 'user', raw: 'Observo el horizonte.' })
    let loaded = false
    let checks = 0
    let loads = 0
    let chats = 0
    const requested = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    await page.route('**/api/llm/model-status?*', (route) => {
      checks += 1
      return route.fulfill({ json: { loaded } })
    })
    await page.route('**/api/llm/model-management', async (route) => {
      loads += 1
      expect(route.request().postDataJSON()).toEqual({ action: 'load', scope: 'normal' })
      requested.resolve(undefined)
      await release.promise
      loaded = true
      await route.fulfill({ json: { status: 'loaded', instanceId: 'modelo-historia' } })
    })
    await page.route('**/api/llm/chat', async (route) => {
      chats += 1
      await route.fulfill({ json: { content: 'Respuesta.', finishReason: 'stop' } })
    })
    try {
      await page.goto(`/stories/${story.id}`)
      await expect.poll(() => checks).toBeGreaterThan(0)
      const area = visualMode
        ? page.getByTestId('story-reader-controls')
        : page.locator(`[data-story-message-id="${lastMessage.id}"]`)
      if (!visualMode) await area.hover()
      const button = page.getByTestId('story-model-load')
      await expect(button).toHaveCount(1)
      await expect(area.getByTestId('story-model-load')).toBeVisible()
      await expect(button.locator('svg')).toBeVisible()
      const loadBounds = await button.boundingBox()
      const adjacentButton = visualMode
        ? page.getByTestId('visual-novel-next')
        : area.getByRole('button', { name: 'Ver datos de debug de la llamada LLM' })
      const adjacentBounds = await adjacentButton.boundingBox()
      expect(loadBounds!.x + loadBounds!.width).toBeLessThanOrEqual(adjacentBounds!.x)
      if (visualMode) {
        expect(loadBounds!.y).toBe(adjacentBounds!.y)
        await page.getByTestId('story-start-button').click()
        await expect(page.getByTestId('visual-novel-frame')).toContainText('Escena 1.')
        await expect(button).toBeVisible()
        await page.getByTestId('story-end-button').click()
        await expect(page.getByTestId('visual-novel-frame')).toContainText('Observo el horizonte.')
        await expect(button).toBeVisible()
      }
      expect(loads).toBe(0)
      const input = page.getByRole('textbox')
      await input.fill('Borrador conservado.')
      const messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
      if (visualMode) await page.getByTestId('visual-novel-frame').hover()
      else await area.hover()
      await button.click()
      await requested.promise
      await expect(button).toHaveText('Cargando…')
      await expect(button).toBeDisabled()
      expect(loads).toBe(1)
      release.resolve(undefined)
      await expect(button).toHaveCount(0)
      await expect(input).toHaveValue('Borrador conservado.')
      expect(chats).toBe(0)
      expect(await data.list<Message>('messages', 'normal', { storyId: story.id })).toEqual(messages)
      loaded = false
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expect(button).toHaveCount(1)
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 })
        await expect(button).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        const bounds = await button.boundingBox()
        expect(bounds!.x).toBeGreaterThanOrEqual(0)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
        await page.screenshot({ path: test.info().outputPath(`load-${width}.png`) })
      }
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.getByTestId('visual-mode-toggle').click()
      await expect(button).toHaveCount(1)
    } finally {
      release.resolve(undefined)
    }
  })
}

test('novela vacía mantiene la carga en navegación y permite reintentar errores sin perder texto', async ({ page, data }) => {
  const story = await data.createStory({ characters: [], visualMode: true })
  let loads = 0
  let loaded = false
  await page.route('**/api/llm/model-status?*', (route) => route.fulfill({ json: { loaded } }))
  await page.route('**/api/llm/model-management', async (route) => {
    loads += 1
    if (loads === 1) {
      await route.fulfill({ status: 502, json: { message: 'LM Studio desconectado' } })
    } else {
      loaded = true
      await route.fulfill({ json: { status: 'already-loaded', instanceId: 'modelo-historia' } })
    }
  })
  await page.goto(`/stories/${story.id}`)
  const input = page.getByRole('textbox')
  const button = page.getByTestId('story-model-load')
  await expect(page.getByTestId('story-reader-controls').getByTestId('story-model-load')).toBeVisible()
  await input.fill('Todavía sin enviar.')
  await button.click()
  await expect(page.getByTestId('story-model-load-error')).toHaveText('LM Studio desconectado')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByTestId('story-model-load-error')).toHaveText('LM Studio desconectado')
  await button.click()
  await expect(button).toHaveCount(0)
  await expect(page.getByTestId('story-model-load-error')).toHaveCount(0)
  await expect(input).toHaveValue('Todavía sin enviar.')
  expect(await data.list<Message>('messages', 'normal', { storyId: story.id })).toEqual([])
})

test('estado desconocido oculta el fallo automático y permite cargar sin interferir con la generación', async ({ page, data }) => {
  const { story, lastMessage } = await storyWithDebug(data, page.request)
  const release = Promise.withResolvers<undefined>()
  await page.route('**/api/llm/model-status?*', (route) => route.fulfill({
    status: 502, json: { message: 'No se pudo comprobar LM Studio' }
  }))
  await page.route('**/api/llm/chat', async (route) => {
    await release.promise
    await route.fulfill({ json: { content: 'Respuesta.', finishReason: 'stop' } })
  })
  try {
    await page.goto(`/stories/${story.id}`)
    await expect(page.getByTestId('story-model-load-error')).toHaveCount(0)
    const area = page.locator(`[data-story-message-id="${lastMessage.id}"]`)
    await area.hover()
    await expect(page.getByTestId('story-model-load')).toBeEnabled()
    await page.getByRole('textbox').fill('Continúa.')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(page.getByTestId('story-model-load')).toBeDisabled()
  } finally {
    release.resolve(undefined)
  }
})

for (const scope of ['normal', 'private'] as const) {
  for (const visualMode of [false, true]) {
    test(`consultas automáticas silenciosas y fallo manual recuperable; scope=${scope}, visual=${visualMode}`, async ({ page, data }) => {
      const story = await data.createStory({ characters: [], visualMode, scope })
      await data.patchSettings({ privateLlmSettingsEnabled: true, privateModel: 'modelo-privado' })
      let checks = 0
      let loads = 0
      let loaded = false
      await page.route('**/api/llm/model-status?*', (route) => {
        expect(new URL(route.request().url()).searchParams.get('scope')).toBe(scope)
        checks += 1
        return route.fulfill(loaded
          ? { json: { loaded: true } }
          : { status: 502, json: { message: 'Consulta automática desconectada' } })
      })
      await page.route('**/api/llm/model-management', (route) => {
        expect(route.request().postDataJSON()).toEqual({ action: 'load', scope })
        loads += 1
        if (loads === 1) {
          return route.fulfill({ status: 502, json: { message: 'Carga manual desconectada' } })
        }
        loaded = true
        return route.fulfill({ json: { status: 'loaded', instanceId: 'modelo-historia' } })
      })
      if (scope === 'private') {
        await page.goto('/settings')
        const privateTrigger = page.getByRole('button', { name: 'Activar modo privado' })
        for (let click = 0; click < 3; click++) await privateTrigger.click()
        await expect(page.locator('html')).toHaveClass(/private-scope/)
      }
      await page.clock.install()
      if (scope === 'private') {
        await page.getByRole('link', { name: 'Historias', exact: true }).click()
        await page.getByRole('link', { name: story.title, exact: true }).click()
      } else {
        await page.goto(`/stories/${story.id}`)
      }
      const error = page.getByTestId('story-model-load-error')
      const button = page.getByTestId('story-model-load')
      const input = page.getByRole('textbox')
      await expect.poll(() => checks).toBeGreaterThan(0)
      await expect(button).toBeEnabled()
      await input.fill('Borrador conservado.')
      const initialChecks = checks
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expect.poll(() => checks).toBeGreaterThan(initialChecks)
      const checksBeforeInterval = checks
      await page.clock.runFor(30_000)
      await expect.poll(() => checks).toBeGreaterThan(checksBeforeInterval)
      await expect(error).toHaveCount(0)
      await expect(page.getByRole('alert')).toHaveCount(0)
      expect(loads).toBe(0)
      await button.click()
      await expect(error).toHaveText('Carga manual desconectada')
      const checksBeforeFocus = checks
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expect.poll(() => checks).toBeGreaterThan(checksBeforeFocus)
      await expect(error).toHaveText('Carga manual desconectada')
      await button.click()
      await expect(button).toHaveCount(0)
      await expect(error).toHaveCount(0)
      await expect(input).toHaveValue('Borrador conservado.')
      expect(await data.list<Message>('messages', scope, { storyId: story.id })).toEqual([])
    })
  }
}

test('comprueba cada 30 segundos y pausa con pestaña oculta', async ({ page, data }) => {
  const story = await data.createStory({ characters: [] })
  let checks = 0
  let loaded = true
  await page.clock.install()
  await page.route('**/api/llm/model-status?*', (route) => {
    checks += 1
    return route.fulfill({ json: { loaded } })
  })
  await page.goto(`/stories/${story.id}`)
  await expect.poll(() => checks).toBe(1)
  await expect(page.getByTestId('story-model-load')).toHaveCount(0)
  loaded = false
  await page.clock.runFor(30_000)
  await expect.poll(() => checks).toBe(2)
  await expect(page.getByTestId('story-model-load')).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.runFor(90_000)
  expect(checks).toBe(2)
  loaded = true
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => checks).toBe(3)
  await expect(page.getByTestId('story-model-load')).toHaveCount(0)
  await page.getByRole('link', { name: 'Historias', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Nueva historia', exact: true })).toBeVisible()
  const checksAfterLeaving = checks
  await page.clock.runFor(60_000)
  expect(checks).toBe(checksAfterLeaving)
})

test('comprueba y carga el ámbito privado al cambiar de modo', async ({ page, data }) => {
  const story = await data.createStory({ characters: [], scope: 'private' })
  await data.patchSettings({ privateLlmSettingsEnabled: true, privateModel: 'modelo-privado' })
  const scopes: DataScope[] = []
  await page.route('**/api/llm/model-status?*', (route) => {
    scopes.push(new URL(route.request().url()).searchParams.get('scope') as DataScope)
    return route.fulfill({ json: { loaded: false } })
  })
  await page.route('**/api/llm/model-management', (route) => {
    expect(route.request().postDataJSON()).toEqual({ action: 'load', scope: 'private' })
    return route.fulfill({ json: { status: 'loaded', instanceId: 'modelo-privado' } })
  })
  await page.goto('/settings')
  const privateTrigger = page.getByRole('button', { name: 'Activar modo privado' })
  for (let click = 0; click < 3; click++) await privateTrigger.click()
  await expect(page.locator('html')).toHaveClass(/private-scope/)
  await page.getByRole('link', { name: 'Historias', exact: true }).click()
  await page.getByRole('link', { name: story.title, exact: true }).click()
  await expect.poll(() => scopes).toEqual(['private'])
  await page.getByTestId('story-model-load').click()
  await page.keyboard.press('Control+Alt+p')
  await expect(page.locator('html')).not.toHaveClass(/private-scope/)
  await expect(page.getByTestId('story-model-load')).toHaveCount(0)
})

test('omite consultas y botón con Chrome, prueba, usuario no administrador e historia de solo lectura', async ({ page, data }) => {
  const story = await data.createStory({ characters: [] })
  let checks = 0
  await page.route('**/api/llm/model-status?*', (route) => {
    checks += 1
    return route.fulfill({ json: { loaded: false } })
  })
  for (const patch of [{ mockMode: true, useChromeLlm: false }, { mockMode: false, useChromeLlm: true }]) {
    await data.patchSettings(patch)
    await page.goto(`/stories/${story.id}`)
    await expect(page.getByTestId('visual-mode-toggle')).toBeVisible()
    await expect(page.getByTestId('story-model-load')).toHaveCount(0)
  }
  await data.patchSettings({ mockMode: false, useChromeLlm: false })
  await page.route('**/api/access', (route) => route.fulfill({ json: {
    multiUserEnabled: true, identity: { id: 'visitor-sub', email: 'visitante@example.com' },
    isAdmin: false, canActivate: false
  } }))
  await page.reload()
  await expect(page.getByTestId('visual-mode-toggle')).toBeVisible()
  await expect(page.getByTestId('story-model-load')).toHaveCount(0)
  await page.unroute('**/api/access')
  await page.route('**/api/data/stories?*', async (route) => {
    const response = await route.fetch()
    const stories = await response.json() as Story[]
    await route.fulfill({ response, json: stories.map((entry) => entry.id === story.id ? { ...entry, readOnly: true } : entry) })
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: story.title })).toBeVisible()
  await expect(page.getByTestId('story-model-load')).toHaveCount(0)
  expect(checks).toBe(0)
})

test('API consulta el modelo configurado de cada ámbito, sin cargar ni devolver credenciales', async ({ page, data }) => {
  const received: string[] = []
  const server = createServer((request, response) => {
    received.push(String(request.headers.authorization))
    expect(request.method).toBe('GET')
    expect(request.url).toBe('/api/v1/models')
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ models: [
      { key: 'modelo-historia', type: 'llm', loaded_instances: [] },
      { key: 'modelo-privado', type: 'llm', loaded_instances: [{ id: 'instancia-privada' }] },
      { key: 'otro-modelo', type: 'llm', loaded_instances: [{ id: 'otra-instancia' }] }
    ] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Puerto de prueba no disponible')
  try {
    const baseUrl = `http://127.0.0.1:${address.port}`
    await data.patchSettings({
      baseUrl, apiKey: 'normal-secret', privateLlmSettingsEnabled: true,
      privateBaseUrl: baseUrl, privateApiKey: 'private-secret', privateModel: 'modelo-privado'
    })
    const normal = await page.request.get('/api/llm/model-status?scope=normal')
    await expect(normal).toBeOK()
    expect(await normal.json()).toEqual({ loaded: false })
    const privateStatus = await page.request.get('/api/llm/model-status?scope=private')
    await expect(privateStatus).toBeOK()
    expect(await privateStatus.json()).toEqual({ loaded: true })
    expect(received).toEqual(['Bearer normal-secret', 'Bearer private-secret'])
    await data.patchSettings({ model: 'modelo-ausente' })
    expect((await page.request.get('/api/llm/model-status?scope=normal')).status()).toBe(400)
    await data.patchSettings({ model: '' })
    expect((await page.request.get('/api/llm/model-status?scope=normal')).status()).toBe(400)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
