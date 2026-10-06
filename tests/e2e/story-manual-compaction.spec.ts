import type { Page } from '@playwright/test'
import type { LlmDebugTrace, Message, Story } from '../../shared/types'
import { test, expect, type TestDataFactory } from './fixtures'

interface Request {
  scope: string
  model: string
  operation?: string
  messages: Array<{ role: string; content: string }>
}

test.beforeEach(async ({ page, data }) => {
  await data.patchSettings({ mockMode: false, model: 'test-model', useChromeLlm: false,
    privateUseChromeLlm: null, privateLlmSettingsEnabled: false, historyBudget: 100000,
    contextTokenBudget: 0, contextUnit: 'characters', maxTokens: 100, responseSpeed: 'instant',
    narrativePrompt: 'Narra la historia.', compactionPrompt: null })
  await page.route('**/api/llm/model-status?*', route => route.fulfill({ json: { loaded: true } }))
  await page.route('**/api/llm/context', route => {
    const request = route.request().postDataJSON() as Request
    const tokens = request.messages.reduce((total, message) => total + Math.ceil(message.content.length / 4), 0)
    return route.fulfill({ json: { tokens, capacity: 30000, model: 'test-instance' } })
  })
})

async function prepare(page: Page, data: TestDataFactory, visualMode = false) {
  const story = await data.createStory({ characters: [], visualMode })
  const old = await data.createMessage({ story, role: 'assistant', raw: 'Hechos de la historia. '.repeat(400) })
  await page.goto(`/stories/${story.id}`)
  return { story, old }
}

async function openDialog(page: Page) {
  await page.getByRole('button', { name: 'Más opciones', exact: true }).click()
  await page.getByRole('button', { name: 'Compactar historia', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Compactar historia', exact: true })
  await expect(dialog.getByRole('button', { name: 'Compactar', exact: true })).toBeEnabled()
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true)
  return dialog
}

for (const visualMode of [false, true]) {
  test(`compacta bajo límite sin narración y conserva borrador, pendiente y mensajes (${visualMode ? 'Novela' : 'Chat'})`, async ({ page, data }) => {
    const { story, old } = await prepare(page, data, visualMode)
    const pending = await data.createMessage({ story, role: 'user', raw: 'PENDIENTE_SIN_RESPUESTA' })
    await page.reload()
    const composer = page.getByPlaceholder(/Escribe lo que haces/)
    await composer.fill('BORRADOR_SIN_ENVIAR')
    const requests: Request[] = []
    await page.route('**/api/llm/chat', async route => {
      const request = route.request().postDataJSON() as Request
      requests.push(request)
      expect(request.operation).toBe('story.compaction')
      expect(JSON.stringify(request.messages)).not.toMatch(/PENDIENTE_SIN_RESPUESTA|BORRADOR_SIN_ENVIAR/)
      await route.fulfill({ json: { content: 'Resumen breve.', finishReason: 'stop' } })
    })
    const dialog = await openDialog(page)
    await expect(dialog.getByTestId('manual-compaction-before')).toContainText('tokens')
    await expect(dialog.getByTestId('manual-compaction-before')).toContainText('caracteres')
    expect(requests).toHaveLength(0)
    await dialog.getByRole('button', { name: 'Compactar', exact: true }).click()
    await expect(dialog.getByTestId('manual-compaction-after')).toContainText('tokens')
    await expect(dialog.getByTestId('manual-compaction-after')).toContainText('Reducción:')
    expect(requests).toHaveLength(1)
    expect(await data.get<Story>('stories', story.id)).toMatchObject({
      contextSummary: 'Resumen breve.', contextSummaryThroughMessageId: old.id
    })
    expect((await data.list<Message>('messages', 'normal', { storyId: story.id })).map(message => message.id)).toEqual([old.id, pending.id])
    const traces = await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })
    expect(traces.at(-1)).toMatchObject({ status: 'success', request: { purpose: 'compaction', compaction: { applied: true,
      beforeUsage: { unit: 'tokens' }, afterUsage: { unit: 'tokens' } } } })
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 760 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
      await expect(dialog.getByRole('button', { name: 'Cerrar diálogo' })).toBeVisible()
      await page.screenshot({ path: `.data/issue-244-${visualMode ? 'novela' : 'chat'}-${width}.png` })
    }
    await dialog.getByRole('button', { name: 'Cerrar diálogo' }).click()
    await expect(composer).toHaveValue('BORRADOR_SIN_ENVIAR')
    await page.reload()
    expect((await data.get<Story>('stories', story.id)).contextSummary).toBe('Resumen breve.')
  })
}

for (const failure of ['vacío', 'truncado', 'sin reducción', 'guardado', 'límite'] as const) {
  test(`resultado ${failure}: conserva checkpoint y permite reintentar`, async ({ page, data }) => {
    const { story, old } = await prepare(page, data)
    await expect(await page.request.put(`/api/data/stories/${story.id}?scope=normal`, { data: {
      ...story, contextSummary: 'Checkpoint anterior extenso. '.repeat(200), contextSummaryThroughMessageId: old.id
    } })).toBeOK()
    // El límite admite las instrucciones actuales, pero no el resumen de 4000 caracteres.
    if (failure === 'límite') await data.patchSettings({ historyBudget: 6000 })
    await page.reload()
    let fail = true
    await page.route(`**/api/data/stories/${story.id}?scope=normal`, async route => {
      if (failure === 'guardado' && fail && route.request().method() === 'PUT') {
        return route.fulfill({ status: 500, json: { message: 'No se pudo guardar el checkpoint.' } })
      }
      await route.continue()
    })
    await page.route('**/api/llm/chat', route => route.fulfill({ json: {
      content: !fail || failure === 'guardado' ? 'Resumen breve.' : failure === 'vacío' ? ''
        : failure === 'sin reducción' ? 'R'.repeat(20000) : failure === 'límite' ? 'R'.repeat(4000) : 'Resumen truncado.',
      finishReason: fail && failure === 'truncado' ? 'length' : 'stop'
    } }))
    const previous = (await data.get<Story>('stories', story.id)).contextSummary
    const dialog = await openDialog(page)
    await dialog.getByRole('button', { name: 'Compactar', exact: true }).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    expect((await data.get<Story>('stories', story.id)).contextSummary).toBe(previous)
    expect(await data.list<Message>('messages', 'normal', { storyId: story.id })).toHaveLength(1)
    const trace = (await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })).at(-1)
    expect(trace).toMatchObject({ status: 'error', request: { purpose: 'compaction', compaction: { applied: false } } })
    if (failure === 'límite') return
    fail = false
    await dialog.getByRole('button', { name: 'Compactar', exact: true }).click()
    await expect(dialog.getByTestId('manual-compaction-after')).toBeVisible()
  })
}

test('tokens no disponibles: permite caracteres y bloquea límite de tokens activo', async ({ page, data }) => {
  await prepare(page, data)
  await page.route('**/api/llm/context', route => route.fulfill({ status: 502, json: { message: 'Tokenizador no disponible.' } }))
  await page.route('**/api/llm/chat', route => route.fulfill({ json: { content: 'Resumen breve.', finishReason: 'stop' } }))
  const dialog = await openDialog(page)
  await expect(dialog.getByTestId('manual-compaction-before')).toContainText('Tokens no disponibles')
  await dialog.getByRole('button', { name: 'Compactar', exact: true }).click()
  await expect(dialog.getByTestId('manual-compaction-after')).toContainText('Tokens no disponibles')
  await dialog.getByRole('button', { name: 'Cerrar diálogo' }).click()
  await data.patchSettings({ contextTokenBudget: 3000 })
  await page.reload()
  await page.getByRole('button', { name: 'Más opciones', exact: true }).click()
  await page.getByRole('button', { name: 'Compactar historia', exact: true }).click()
  await expect(dialog.getByTestId('manual-compaction-before')).toContainText('Tokens no disponibles')
  await expect(dialog.getByRole('button', { name: 'Compactar', exact: true })).toBeDisabled()
})

test('ofrece bloques explícitos aunque solo límite de caracteres esté activo, sin continuación', async ({ page, data }) => {
  const { story, old } = await prepare(page, data)
  await page.route('**/api/llm/context', route => {
    const request = route.request().postDataJSON() as Request
    const tokens = request.messages.reduce((total, message) => total + Math.ceil(message.content.length / 4), 0)
    return route.fulfill({ json: { tokens, capacity: 1900, model: 'test-instance' } })
  })
  let calls = 0
  await page.route('**/api/llm/chat', route => {
    calls += 1
    expect(route.request().postDataJSON().operation).toBe('story.compaction')
    return route.fulfill({ json: { content: 'Resumen acumulado.', finishReason: 'stop' } })
  })
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Compactar', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Compactar por bloques', exact: true })).toBeEnabled()
  expect(calls).toBe(0)
  expect((await data.get<Story>('stories', story.id)).contextSummary).toBeFalsy()
  await dialog.getByRole('button', { name: 'Compactar por bloques', exact: true }).click()
  await expect(dialog.getByTestId('manual-compaction-after')).toBeVisible()
  expect(calls).toBeGreaterThan(1)
  expect(await data.list<Message>('messages', 'normal', { storyId: story.id })).toHaveLength(1)
  expect(await data.get<Story>('stories', story.id)).toMatchObject({ contextSummary: 'Resumen acumulado.', contextSummaryThroughMessageId: old.id })
})

test('cancelación y navegación no guardan resultados tardíos', async ({ page, data }) => {
  const { story } = await prepare(page, data)
  let release: (() => void) | undefined
  const waiting = new Promise<void>(resolve => { release = resolve })
  let requested = false
  await page.route('**/api/llm/chat', async route => {
    requested = true
    await waiting
    await route.fulfill({ json: { content: 'Resumen tardío.', finishReason: 'stop' } }).catch(() => undefined)
  })
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Compactar', exact: true }).click()
  await expect.poll(() => requested).toBe(true)
  await expect(dialog.getByRole('button', { name: 'Cerrar diálogo' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancelar compactación' }).click()
  await expect(dialog.getByRole('alert')).toContainText('cancelada')
  await dialog.getByRole('button', { name: 'Cerrar diálogo' }).click()
  await page.goto('/')
  release!()
  await page.goto(`/stories/${story.id}`)
  expect((await data.get<Story>('stories', story.id)).contextSummary).toBeFalsy()
  expect(await data.list<Message>('messages', 'normal', { storyId: story.id })).toHaveLength(1)
})

test('respeta colección privada y unidad elegida para rechazar crecimiento en tokens', async ({ page, data }) => {
  await data.patchSettings({ privateLlmSettingsEnabled: true, privateModel: 'private-model',
    privateContextUnit: 'tokens', privateContextTokenBudget: 0, privateMaxTokens: 100 })
  const story = await data.createStory({ characters: [], scope: 'private' })
  await data.createMessage({ story, scope: 'private', role: 'assistant', raw: 'Historia privada. '.repeat(400) })
  await page.route('**/api/llm/context', route => {
    const request = route.request().postDataJSON() as Request
    expect(request.scope).toBe('private')
    expect(request.model).toBe('private-model')
    return route.fulfill({ json: { tokens: JSON.stringify(request.messages).includes('RESUMEN_NUEVO') ? 2000 : 1000,
      capacity: 30000, model: 'private-instance' } })
  })
  await page.route('**/api/llm/chat', route => {
    expect(route.request().postDataJSON()).toMatchObject({ scope: 'private', model: 'private-instance', operation: 'story.compaction' })
    return route.fulfill({ json: { content: 'RESUMEN_NUEVO', finishReason: 'stop' } })
  })
  await page.goto('/')
  await page.locator('main').press('Control+Alt+p')
  await expect(page.locator('html')).toHaveClass(/private-scope/)
  await page.locator(`a[href="/stories/${story.id}"]`).first().click()
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Compactar', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('no reduce el contexto')
  expect((await data.get<Story>('stories', story.id, 'private')).contextSummary).toBeFalsy()
})

test('sin historial y modo mock deshabilitan compactación', async ({ page, data }) => {
  const story = await data.createStory({ characters: [] })
  await page.goto(`/stories/${story.id}`)
  await page.getByRole('button', { name: 'Más opciones', exact: true }).click()
  await page.getByRole('button', { name: 'Compactar historia', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Compactar historia' })
  await expect(dialog.getByText('No hay historial anterior que compactar.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Compactar', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cerrar diálogo' }).click()
  await data.patchSettings({ mockMode: true })
  await page.reload()
  await page.getByRole('button', { name: 'Más opciones', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Compactar historia', exact: true })).toBeDisabled()
})

test('bloquea cancelación durante guardado del checkpoint y la traza', async ({ page, data }) => {
  const { story } = await prepare(page, data)
  await page.route('**/api/llm/chat', route => route.fulfill({ json: { content: 'Resumen guardado.', finishReason: 'stop' } }))
  let release: (() => void) | undefined
  const waiting = new Promise<void>(resolve => { release = resolve })
  let savingTrace = false
  await page.route('**/api/data/llmDebugTraces/*?scope=normal', async route => {
    if (route.request().method() === 'PUT') {
      savingTrace = true
      await waiting
    }
    await route.continue()
  })
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Compactar', exact: true }).click()
  await expect.poll(() => savingTrace).toBe(true)
  expect((await data.get<Story>('stories', story.id)).contextSummary).toBe('Resumen guardado.')
  await expect(dialog.getByRole('button', { name: 'Cancelar compactación' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Cerrar diálogo' })).toBeDisabled()
  release!()
  await expect(dialog.getByTestId('manual-compaction-after')).toBeVisible()
})

test('Chrome mide ambas unidades y compacta sin llamadas a LM Studio', async ({ page, data }) => {
  await data.patchSettings({ useChromeLlm: true, contextTokenBudget: 0, maxTokens: 100000 })
  await page.addInitScript(() => {
    class FakeLanguageModel {
      contextWindow = 30000
      contextUsage = 0
      static async availability() { return 'available' }
      static async create() { return new FakeLanguageModel() }
      async measureContextUsage(messages: unknown) { return Math.ceil(JSON.stringify(messages).length / 4) }
      async prompt() { return 'Resumen Chrome.' }
      destroy() {}
    }
    Object.defineProperty(window, 'LanguageModel', { value: FakeLanguageModel, configurable: true })
  })
  await prepare(page, data)
  let lmStudioCalls = 0
  await page.route('**/api/llm/chat', route => { lmStudioCalls += 1; return route.fulfill({ status: 500 }) })
  await page.route('**/api/llm/context', route => { lmStudioCalls += 1; return route.fulfill({ status: 500 }) })
  const dialog = await openDialog(page)
  await expect(dialog.getByTestId('manual-compaction-before')).toContainText('tokens')
  await dialog.getByRole('button', { name: 'Compactar', exact: true }).click()
  await expect(dialog.getByTestId('manual-compaction-after')).toContainText('tokens')
  expect(lmStudioCalls).toBe(0)
})

test('solo lectura oculta compactación manual', async ({ page, data }) => {
  const { story } = await prepare(page, data)
  await page.route('**/api/data/stories?scope=normal', async route => {
    const response = await route.fetch()
    const stories = await response.json() as Story[]
    await route.fulfill({ json: stories.map(value => value.id === story.id ? { ...value, readOnly: true } : value) })
  })
  await page.reload()
  await page.getByRole('button', { name: 'Más opciones', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Compactar historia', exact: true })).toHaveCount(0)
})
