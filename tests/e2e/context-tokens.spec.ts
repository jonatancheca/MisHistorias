import type { LlmDebugTrace, Message, Story } from '../../shared/types'
import { test, expect } from './fixtures'
import { startFakeLmStudio } from '../helpers/fakeLmStudio'

test.beforeEach(async ({ page, data }) => {
  await data.patchSettings({
    mockMode: false, model: 'test-model', useChromeLlm: false, privateUseChromeLlm: null,
    privateLlmSettingsEnabled: false, contextUnit: 'tokens', contextTokenBudget: 3000,
    historyBudget: 12000, maxTokens: 100, responseSpeed: 'instant',
    narrativePrompt: 'Narra la historia.', compactionPrompt: null,
    privateContextUnit: null, privateContextTokenBudget: null
  })
  await page.route('**/api/llm/model-status?*', route => route.fulfill({ json: { loaded: true } }))
})

test.afterEach(async ({ data }) => {
  await data.patchSettings({ contextUnit: 'characters', useChromeLlm: false, privateUseChromeLlm: null,
    privateLlmSettingsEnabled: false, maxTokens: 10000 })
})

for (const limits of [
  { name: 'caracteres con tokens por debajo', characters: 3000, tokens: 20000, compact: true },
  { name: 'tokens con caracteres por debajo', characters: 100000, tokens: 1500, compact: true },
  { name: 'solo caracteres', characters: 3000, tokens: 0, compact: true },
  { name: 'solo tokens', characters: 0, tokens: 1500, compact: true },
  { name: 'ambos desactivados', characters: 0, tokens: 0, compact: false }
]) {
  test(`límites simultáneos: ${limits.name}`, async ({ page, data }) => {
    await data.patchSettings({ historyBudget: limits.characters, contextTokenBudget: limits.tokens })
    const story = await data.createStory({ characters: [] })
    await data.createMessage({ story, role: 'assistant', raw: 'Hecho anterior. '.repeat(700) })
    let measurements = 0
    let compactions = 0
    await page.route('**/api/llm/context', async route => {
      measurements += 1
      const { messages } = route.request().postDataJSON()
      const tokens = messages.reduce((total: number, message: { content: string }) => total + Math.ceil(message.content.length / 4), 0)
      await route.fulfill({ json: { tokens, capacity: 30000, model: 'test-instance' } })
    })
    await page.route('**/api/llm/chat', async route => {
      const request = route.request().postDataJSON()
      if (request.operation === 'story.compaction') {
        compactions += 1
        expect(JSON.stringify(request.messages)).not.toContain('MENSAJE_PENDIENTE')
        if (limits.characters && limits.tokens) {
          expect(request.messages[0].content).toMatch(/máximo \d+ tokens/)
          expect(request.messages[0].content).toMatch(/máximo \d+ caracteres/)
        }
        return route.fulfill({ json: { content: 'Resumen breve.', finishReason: 'stop' } })
      }
      await route.fulfill({ json: { content: 'Respuesta con límites comprobados.', finishReason: 'stop' } })
    })
    await page.goto(`/stories/${story.id}`)
    await page.getByPlaceholder(/Escribe lo que haces/).fill('MENSAJE_PENDIENTE')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(page.getByText('Respuesta con límites comprobados.', { exact: true })).toBeVisible()
    expect(compactions).toBe(limits.compact ? 1 : 0)
    expect(measurements > 0).toBe(limits.tokens > 0)
  })
}

test('rechaza resumen que cabe en tokens pero sigue excediendo caracteres', async ({ page, data }) => {
  await data.patchSettings({ historyBudget: 3000, contextTokenBudget: 20000 })
  const story = await data.createStory({ characters: [] })
  await data.createMessage({ story, role: 'assistant', raw: 'Historia anterior. '.repeat(600) })
  await page.route('**/api/llm/context', route => route.fulfill({ json: { tokens: 1000, capacity: 30000, model: 'test-instance' } }))
  let calls = 0
  await page.route('**/api/llm/chat', async route => {
    calls += 1
    expect(route.request().postDataJSON().operation).toBe('story.compaction')
    await route.fulfill({ json: { content: 'R'.repeat(4000), finishReason: 'stop' } })
  })
  await page.goto(`/stories/${story.id}`)
  const composer = page.getByPlaceholder(/Escribe lo que haces/)
  await composer.fill('Borrador intacto.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('caracteres y el límite es 3000')
  await expect(composer).toHaveValue('Borrador intacto.')
  expect(calls).toBe(1)
  expect((await data.get<Story>('stories', story.id)).contextSummary).toBeFalsy()
})

test('muestra ambos límites y conserva valores normales y privados tras recargar', async ({ page, data }) => {
  await data.patchSettings({ contextUnit: 'characters', historyBudget: 54321 })
  await page.goto('/settings#llm')
  await expect(page.getByLabel('Unidad del contexto enviado')).toHaveCount(0)
  await expect(page.getByLabel('MÁX. CONTEXTO ENVIADO (CARACTERES)', { exact: true })).toHaveValue('54321')
  await page.getByLabel('MÁX. CONTEXTO ENVIADO (TOKENS)', { exact: true }).fill('4123')
  await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).contextTokenBudget).toBe(4123)
  await page.reload()
  await expect(page.getByLabel('MÁX. CONTEXTO ENVIADO (TOKENS)', { exact: true })).toHaveValue('4123')
  await expect(page.getByLabel('MÁX. CONTEXTO ENVIADO (CARACTERES)', { exact: true })).toHaveValue('54321')
  await data.patchSettings({ privateLlmSettingsEnabled: true, privateContextUnit: 'tokens', privateContextTokenBudget: 7890 })
  await page.reload()
  await page.locator('main').press('Control+Alt+p')
  await expect(page.locator('html')).toHaveClass(/private-scope/)
  await expect(page.getByLabel('MÁX. CONTEXTO ENVIADO (TOKENS)', { exact: true })).toHaveValue('7890')
  await page.getByLabel('MÁX. CONTEXTO ENVIADO (TOKENS)', { exact: true }).fill('7900')
  await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).privateContextTokenBudget).toBe(7900)
  const saved = await (await page.request.get('/api/settings')).json()
  expect(saved.historyBudget).toBe(54321)
  expect(saved.contextTokenBudget).toBe(4123)
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 760 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('respeta capacidad con reserva, límite exacto y Debug histórico en tokens', async ({ page, data }) => {
  await data.patchSettings({ contextTokenBudget: 10000, historyBudget: 0 })
  const story = await data.createStory({ characters: [] })
  await page.route('**/api/llm/context', route => route.fulfill({ json: { tokens: 2000, capacity: 2100, model: 'test-instance' } }))
  await page.route('**/api/llm/chat', async route => {
    expect(route.request().postDataJSON().model).toBe('test-instance')
    await route.fulfill({ json: { content: 'Respuesta en el límite exacto.', finishReason: 'stop' } })
  })
  await page.goto(`/stories/${story.id}`)
  await page.getByPlaceholder(/Escribe lo que haces/).fill('Nueva intervención.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByText('Respuesta en el límite exacto.', { exact: true })).toBeVisible()
  const traces = await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })
  expect(traces.at(-1)?.request.contextUsage).toMatchObject({ unit: 'tokens', count: 2000,
    configuredLimit: 10000, effectiveLimit: 2000, capacity: 2100, reservedTokens: 100, model: 'test-instance' })
  await data.patchSettings({ contextUnit: 'characters', historyBudget: 5 })
  await page.reload()
  await page.getByTestId('story-tools-toggle').click()
  await page.getByTestId('story-debug-toggle').click()
  await page.getByRole('button', { name: 'Ver datos de debug de la llamada LLM', exact: true }).last().click()
  await expect(page.getByTestId('llm-debug-context-usage')).toContainText('2000 / 2000 tokens')
  await expect(page.getByTestId('llm-debug-context-usage')).toContainText('test-instance')
})

test('fallo de medición bloquea narrador y conserva borrador, mensajes y checkpoint', async ({ page, data }) => {
  const story = await data.createStory({ characters: [] })
  let narrator = 0
  await page.route('**/api/llm/context', route => route.fulfill({ status: 502, json: { message: 'Tokenizador no disponible.' } }))
  await page.route('**/api/llm/chat', async route => { narrator += 1; await route.fulfill({ status: 500 }) })
  await page.goto(`/stories/${story.id}`)
  const composer = page.getByPlaceholder(/Escribe lo que haces/)
  await composer.fill('Borrador protegido.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Tokenizador no disponible.')
  await expect(composer).toHaveValue('Borrador protegido.')
  expect(await data.list<Message>('messages', 'normal', { storyId: story.id })).toHaveLength(0)
  expect(narrator).toBe(0)
  await expect(page.getByRole('button', { name: 'Compactar por bloques' })).toHaveCount(0)
})

for (const visualMode of [false, true]) {
  test(`compactador excesivo propone bloques en ${visualMode ? 'Novela Visual' : 'Chat'} y guarda un único checkpoint`, async ({ page, data }) => {
    const story = await data.createStory({ characters: [], visualMode })
    const raw = 'HECHO_PASADO. '.repeat(2500)
    const old = await data.createMessage({ story, role: 'assistant', raw, segments: [{ type: 'narration', text: raw }] })
    const histories: string[] = []
    let narrator = 0
    await page.route('**/api/llm/context', async route => {
      const request = route.request().postDataJSON()
      expect(request.scope).toBe('normal')
      const tokens = request.messages.reduce((sum: number, message: { content: string }) => sum + Math.ceil(message.content.length / 4) + 2, 0)
      await route.fulfill({ json: { tokens, capacity: 6000, model: 'test-instance' } })
    })
    await page.route('**/api/llm/chat', async route => {
      const request = route.request().postDataJSON()
      if (request.operation === 'story.compaction') {
        const body = JSON.parse(request.messages[1].content)
        expect(JSON.stringify(body)).not.toContain('INTERVENCION_PENDIENTE')
        histories.push(...body.history.map((message: { content: string }) => message.content))
        expect((await data.get<Story>('stories', story.id)).contextSummary).toBeFalsy()
        return route.fulfill({ json: { content: 'Resumen de todos los hechos.', finishReason: 'stop' } })
      }
      narrator += 1
      expect((await data.get<Story>('stories', story.id)).contextSummaryThroughMessageId).toBe(old.id)
      await route.fulfill({ json: { content: 'Respuesta tras compactar por bloques.', finishReason: 'stop' } })
    })
    await page.goto(`/stories/${story.id}`)
    const composer = page.getByPlaceholder(/Escribe lo que haces/)
    await composer.fill('INTERVENCION_PENDIENTE')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    const button = page.getByRole('button', { name: 'Compactar por bloques', exact: true })
    await expect(button).toBeVisible()
    await expect(composer).toHaveValue('INTERVENCION_PENDIENTE')
    expect(histories).toHaveLength(0)
    expect(narrator).toBe(0)
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 760 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await button.click()
    if (visualMode) await expect(page.getByTestId('visual-novel-frame')).toContainText('Respuesta tras compactar por bloques.')
    else await expect(page.getByText('Respuesta tras compactar por bloques.', { exact: true })).toBeVisible()
    expect(histories.join('')).toBe(raw)
    expect(histories.length).toBeGreaterThan(1)
    expect(narrator).toBe(1)
    await expect(composer).toHaveValue('')
    expect((await data.list<Message>('messages', 'normal', { storyId: story.id })).map(message => message.role)).toEqual(['assistant', 'user', 'assistant'])
    const traces = await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })
    expect(traces.filter(trace => trace.request.compaction?.applied)).toHaveLength(1)
    expect(traces.find(trace => trace.request.compaction?.applied)?.request.compaction?.blocks?.length).toBe(histories.length)
    if (visualMode) await page.getByRole('button', { name: 'Mostrar menú de historia' }).click()
    await page.getByTestId('story-tools-toggle').click()
    await page.getByTestId('story-debug-toggle').click()
    if (visualMode) {
      await page.getByTestId('visual-novel-previous').click()
      await page.getByTestId('visual-novel-previous').click()
    }
    await page.getByTestId(visualMode ? 'visual-novel-view' : 'story-scroller').getByTestId('story-compaction-marker').last().getByRole('button', { name: 'Ver antes / después' }).click()
    await expect(page.getByRole('dialog', { name: 'Debug compactación' })).toContainText('tokens')
    await page.screenshot({ path: test.info().outputPath(visualMode ? 'tokens-debug-novela-390.png' : 'tokens-debug-chat-390.png') })
  })
}

test('Chrome mide cuota propia sin reserva LM Studio ni fallback de proveedor', async ({ page, data }) => {
  await data.patchSettings({ useChromeLlm: true, contextTokenBudget: 3000, maxTokens: 100000 })
  await page.addInitScript(() => {
    class FakeLanguageModel {
      contextWindow = 2048
      contextUsage = 0
      static async availability() { return 'available' }
      static async create() { return new FakeLanguageModel() }
      async measureContextUsage() { return 500 }
      async prompt() { return 'Respuesta Chrome medida.' }
      destroy() {}
    }
    Object.defineProperty(globalThis, 'LanguageModel', { configurable: true, value: FakeLanguageModel })
  })
  let fallback = 0
  await page.route('**/api/llm/context', async route => { fallback += 1; await route.fulfill({ status: 500 }) })
  await page.route('**/api/llm/chat', async route => { fallback += 1; await route.fulfill({ status: 500 }) })
  const story = await data.createStory({ characters: [] })
  await page.goto(`/stories/${story.id}`)
  await page.getByPlaceholder(/Escribe lo que haces/).fill('Intervención Chrome.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByText('Respuesta Chrome medida.', { exact: true })).toBeVisible()
  const trace = (await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })).at(-1)
  expect(trace?.request.contextUsage).toMatchObject({ unit: 'tokens', capacity: 2048, reservedTokens: 0, effectiveLimit: 2048, model: 'chrome-prompt-api' })
  expect(fallback).toBe(0)
})

for (const action of ['fallo', 'cancelar', 'borrador cambiado'] as const) {
  test(`bloques: ${action} conserva checkpoint y usuario pendiente`, async ({ page, data }) => {
    const story = await data.createStory({ characters: [] })
    const checkpoint = await data.createMessage({ story, role: 'assistant', raw: 'Antes del checkpoint.' })
    await page.request.put(`/api/data/stories/${story.id}?scope=normal`, { data: {
      ...story, contextSummary: 'Checkpoint anterior.', contextSummaryThroughMessageId: checkpoint.id
    } })
    await data.createMessage({ story, role: 'assistant', raw: 'Pasado posterior. '.repeat(2500) })
    let calls = 0
    const gate = Promise.withResolvers<undefined>()
    await page.route('**/api/llm/context', async route => {
      const { messages } = route.request().postDataJSON()
      await route.fulfill({ json: { tokens: messages.reduce((sum: number, message: { content: string }) => sum + Math.ceil(message.content.length / 4) + 2, 0), capacity: 6000, model: 'test-instance' } })
    })
    await page.route('**/api/llm/chat', async route => {
      expect(route.request().postDataJSON().operation).toBe('story.compaction')
      calls += 1
      if (calls === 1) return route.fulfill({ json: { content: 'Resumen parcial en memoria.', finishReason: 'stop' } })
      if (action === 'cancelar') await gate.promise
      await route.fulfill({ status: 502, json: { message: 'Falló el segundo bloque.' } }).catch(() => {})
    })
    await page.goto(`/stories/${story.id}`)
    const composer = page.getByPlaceholder(/Escribe lo que haces/)
    await composer.fill('Intervención pendiente.')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    const button = page.getByRole('button', { name: 'Compactar por bloques', exact: true })
    await expect(button).toBeVisible()
    if (action === 'borrador cambiado') await composer.fill('Intervención nueva.')
    await button.click()
    if (action === 'borrador cambiado') {
      await expect(page.getByRole('alert')).toContainText('El borrador ha cambiado')
      expect(calls).toBe(0)
    } else if (action === 'cancelar') {
      await expect.poll(() => calls).toBe(2)
      await page.getByRole('button', { name: 'Parar', exact: true }).last().click()
      gate.resolve(undefined)
      await expect(page.getByTestId('compacting-indicator')).toBeHidden()
    } else {
      await expect(page.getByRole('alert')).toContainText('Falló el segundo bloque.')
      expect(calls).toBe(2)
      const trace = (await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })).at(-1)!
      expect(trace.request.compaction?.applied).toBe(false)
      expect(trace.request.compaction?.blocks).toHaveLength(1)
    }
    await expect(composer).toHaveValue(action === 'borrador cambiado' ? 'Intervención nueva.' : 'Intervención pendiente.')
    expect(await data.list<Message>('messages', 'normal', { storyId: story.id })).toHaveLength(2)
    expect(await data.get<Story>('stories', story.id)).toMatchObject({ contextSummary: 'Checkpoint anterior.', contextSummaryThroughMessageId: checkpoint.id })
  })
}

test('tokens privados usan su límite, modelo e identidad de ámbito y compactan sin bloques si caben', async ({ page, data }) => {
  await data.patchSettings({ privateLlmSettingsEnabled: true, privateModel: 'private-model',
    privateContextUnit: 'tokens', privateContextTokenBudget: 1500, privateMaxTokens: 100,
    contextTokenBudget: 3000 })
  const story = await data.createStory({ characters: [], scope: 'private' })
  await data.createMessage({ story, scope: 'private', role: 'assistant', raw: 'Historia privada. '.repeat(500) })
  let compacted = false
  await page.route('**/api/llm/context', async route => {
    const request = route.request().postDataJSON()
    expect(request.scope).toBe('private')
    expect(request.model).toBe('private-model')
    const tokens = request.messages.reduce((sum: number, message: { content: string }) => sum + Math.ceil(message.content.length / 4), 0)
    await route.fulfill({ json: { tokens, capacity: 10000, model: 'private-instance' } })
  })
  await page.route('**/api/llm/chat', async route => {
    const request = route.request().postDataJSON()
    expect(request.scope).toBe('private')
    expect(request.model).toBe('private-instance')
    if (request.operation === 'story.compaction') {
      compacted = true
      return route.fulfill({ json: { content: 'Resumen privado.', finishReason: 'stop' } })
    }
    await route.fulfill({ json: { content: 'Respuesta privada medida.', finishReason: 'stop' } })
  })
  await page.goto('/')
  await page.locator('main').press('Control+Alt+p')
  await expect(page.locator('html')).toHaveClass(/private-scope/)
  await page.locator(`a[href="/stories/${story.id}"]`).first().click()
  await page.getByPlaceholder(/Escribe lo que haces/).fill('Nueva intervención privada.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByText('Respuesta privada medida.', { exact: true })).toBeVisible()
  expect(compacted).toBe(true)
  const trace = (await data.list<LlmDebugTrace>('llmDebugTraces', 'private', { storyId: story.id })).at(-1)!
  expect(trace.request.contextUsage).toMatchObject({ unit: 'tokens', configuredLimit: 1500, model: 'private-instance' })
})

test('endpoint Nitro real mide con SDK y respeta conexión normal y privada', async ({ page, data }) => {
  const server = await startFakeLmStudio()
  const privateServer = await startFakeLmStudio({ tokens: 11, capacity: 4096, identifier: 'private-instance' })
  const previous = await (await page.request.get('/api/settings')).json()
  try {
    await data.patchSettings({ baseUrl: server.baseUrl, apiKey: '', privateLlmSettingsEnabled: true,
      privateBaseUrl: privateServer.baseUrl, privateApiKey: '' })
    for (const scope of ['normal', 'private']) {
      const response = await page.request.post('/api/llm/context', { data: {
        scope, model: 'configured-key', messages: [{ role: 'user', content: 'Hola' }]
      } })
      await expect(response).toBeOK()
      expect(await response.json()).toEqual(scope === 'normal'
        ? { tokens: 7, capacity: 8192, model: 'loaded-instance' }
        : { tokens: 11, capacity: 4096, model: 'private-instance' })
    }
    expect(server.calls.map(call => call.endpoint)).toEqual([
      'listLoaded', 'applyPromptTemplate', 'countTokens', 'getLoadConfig'
    ])
    expect(privateServer.calls.map(call => call.endpoint)).toEqual(['listLoaded', 'applyPromptTemplate', 'countTokens', 'getLoadConfig'])
    const absent = await page.request.post('/api/llm/context', { data: {
      scope: 'normal', model: 'modelo-no-cargado', messages: [{ role: 'user', content: 'Hola' }]
    } })
    expect(absent.status()).toBe(409)
    expect(await absent.json()).toMatchObject({ data: { code: 'model_not_loaded' } })
  } finally {
    await data.patchSettings({ baseUrl: previous.baseUrl, privateLlmSettingsEnabled: previous.privateLlmSettingsEnabled,
      privateBaseUrl: previous.privateBaseUrl ?? null })
    await server.close()
    await privateServer.close()
  }
})
