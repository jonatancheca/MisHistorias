import type { LlmDebugTrace } from '../../shared/types'
import { test, expect, PNG_BYTES } from './fixtures'
import { startFakeLmStudio } from '../helpers/fakeLmStudio'

test.beforeEach(async ({ page, data }) => {
  await data.patchSettings({ maxTokens: 1000, contextTokenBudget: 3000, historyBudget: 0,
    privateMaxTokens: null, privateContextTokenBudget: null, privateLlmSettingsEnabled: false,
    model: 'configured-key', apiKey: '', useChromeLlm: false, privateUseChromeLlm: null,
    mockMode: false, responseSpeed: 'instant', narrativePrompt: 'Narra la historia.' })
  await page.route('**/api/llm/model-status?*', route => route.fulfill({ json: { loaded: true } }))
})

test.afterEach(async ({ data }) => {
  await data.patchSettings({ maxTokens: 10000, contextTokenBudget: 0, privateMaxTokens: null,
    privateContextTokenBudget: null, privateLlmSettingsEnabled: false })
})

test('ambos Auto persisten, muestran capacidad actual y conservan herencia privada', async ({ page }) => {
  let capacity = 8192
  await page.route('**/api/llm/capacity?*', route => route.fulfill({ json: { capacity, model: 'loaded-instance' } }))
  await page.goto('/settings#llm')
  await page.getByRole('checkbox', { name: 'Auto para respuesta', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Auto para contexto', exact: true }).check()
  await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).maxTokens).toBe('auto')
  await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).contextTokenBudget).toBe('auto')
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Auto para respuesta', exact: true })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Auto para contexto', exact: true })).toBeChecked()
  await expect(page.getByLabel('MÁX. CONTEXTO ENVIADO (TOKENS)', { exact: true })).toHaveValue('4096 tokens')
  await expect(page.getByTestId('llm-token-capacity')).toContainText('8192 tokens')
  capacity = 32768
  await page.getByTestId('llm-token-capacity').getByRole('button', { name: 'Actualizar' }).click()
  await expect(page.getByLabel('MÁX. CONTEXTO ENVIADO (TOKENS)', { exact: true })).toHaveValue('28.672 tokens')
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.locator('#maxTokens').evaluate(input => {
      const checkbox = input.parentElement!.querySelector<HTMLInputElement>('input[type="checkbox"]')!
      return input.getBoundingClientRect().right <= checkbox.getBoundingClientRect().left &&
        document.documentElement.scrollWidth <= innerWidth
    })).toBe(true)
    if (width === 390 || width === 1280) {
      await page.getByTestId('llm-token-capacity').scrollIntoViewIfNeeded()
      await page.screenshot({ path: `.data/issue-248-auto-${width}.png`, animations: 'disabled' })
    }
  }
  await page.locator('main').press('Control+Alt+p')
  await expect(page.locator('html')).toHaveClass(/private-scope/)
  await expect(page.getByRole('checkbox', { name: 'Auto para contexto', exact: true })).toBeChecked()
  await page.getByRole('checkbox', { name: /Personalizar ajustes de LMStudio/ }).check()
  await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).privateMaxTokens).toBe('auto')
  await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).privateContextTokenBudget).toBe('auto')
  await page.getByRole('checkbox', { name: 'Auto para respuesta', exact: true }).uncheck()
  await page.getByLabel('Máx. tokens de respuesta', { exact: true }).fill('2000')
  await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).privateMaxTokens).toBe(2000)
  expect((await (await page.request.get('/api/settings')).json()).maxTokens).toBe('auto')
  await expect(page.getByLabel('MÁX. CONTEXTO ENVIADO (TOKENS)', { exact: true })).toHaveValue('30.768 tokens')
  await page.getByRole('checkbox', { name: /Personalizar ajustes de LMStudio/ }).uncheck()
  await expect(page.getByRole('checkbox', { name: 'Auto para respuesta', exact: true })).toBeChecked()
})

test('API consulta instancia actual, recalcula salida y no genera con medición inválida', async ({ request, data }) => {
  const server = await startFakeLmStudio()
  try {
    await data.patchSettings({ baseUrl: server.baseUrl, maxTokens: 'auto', contextTokenBudget: 'auto' })
    const capacity = await request.get('/api/llm/capacity?scope=normal')
    expect(await capacity.json()).toEqual({ capacity: 8192, model: 'loaded-instance' })
    expect(server.calls.map(call => call.endpoint)).toEqual(['listLoaded', 'getLoadConfig'])
    const body = { model: 'configured-key', maxTokens: 'auto', messages: [{ role: 'user', content: 'Hola' }] }
    const first = await request.post('/api/llm/chat', { data: body })
    expect(first.ok()).toBe(true)
    expect((await first.json()).maxTokens).toBe(8185)
    expect(server.chatRequests[0]?.max_tokens).toBe(8185)
    expect(server.chatRequests[0]?.model).toBe('loaded-instance')
    server.setMeasurement(1000, 12288)
    expect((await (await request.post('/api/llm/chat', { data: body })).json()).maxTokens).toBe(11288)
    const absent = await request.post('/api/llm/chat', { data: { ...body, model: 'ausente' } })
    expect(absent.status()).toBe(409)
    server.setMeasurement(12288, 12288)
    expect((await request.post('/api/llm/chat', { data: body })).ok()).toBe(false)
    expect(server.chatRequests).toHaveLength(2)
    const image = { role: 'user', content: [{ type: 'text', text: 'Describe' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_BYTES.toString('base64')}` } }] }
    const unsupported = await request.post('/api/llm/chat', { data: { ...body, messages: [image] } })
    expect(unsupported.status()).toBe(422)
    expect((await unsupported.json()).message).toContain('tokens de las imágenes')
    expect(server.chatRequests).toHaveLength(2)
    expect((await request.post('/api/llm/chat', { data: { ...body, maxTokens: 1000, messages: [image] } })).ok()).toBe(true)
  } finally { await server.close() }
})

test('Ajustes identifica token inválido y recupera cálculo al quitarlo', async ({ page, data }) => {
  const server = await startFakeLmStudio()
  try {
    await data.patchSettings({ baseUrl: server.baseUrl, apiKey: 'token-de-pruebas-invalido' })
    const response = await page.request.get('/api/llm/capacity?scope=normal')
    expect(response.status()).toBe(502)
    expect(await response.json()).toMatchObject({ data: { code: 'api_token' } })
    await page.goto('/settings#llm')
    const capacity = page.getByTestId('llm-token-capacity')
    await capacity.getByRole('button', { name: 'Actualizar' }).click()
    await expect(capacity).toContainText('El token configurado no es un token API válido de LM Studio.')
    await expect(capacity).not.toContainText('token-de-pruebas-invalido')
    await page.getByRole('button', { name: 'Quitar token', exact: true }).click()
    await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).apiKeyConfigured).toBe(false)
    await capacity.getByRole('button', { name: 'Actualizar' }).click()
    await expect(capacity).toContainText('Capacidad actual: 8192 tokens.')
  } finally { await server.close() }
})

test('Ajustes conserva diagnóstico de capacidad aunque producción oculte el mensaje de error', async ({ page }) => {
  await page.route('**/api/llm/capacity?*', route => route.fulfill({ status: 502, json: {
    statusCode: 502, statusMessage: 'Server Error', data: {
      code: 'sdk_unavailable', message: 'No se pudo localizar el SDK de LM Studio incluido en la aplicación.'
    }
  } }))
  await page.goto('/settings#llm')
  const capacity = page.getByTestId('llm-token-capacity')
  await capacity.getByRole('button', { name: 'Actualizar', exact: true }).click()
  await expect(capacity).toContainText('No se pudo localizar el SDK de LM Studio incluido en la aplicación.')
})

for (const visualMode of [false, true]) {
  test(`ambos Auto generan con reserva y guardan máximo real en Debug (${visualMode ? 'Novela Visual' : 'Chat'})`, async ({ page, data }) => {
    const server = await startFakeLmStudio()
    try {
      await data.patchSettings({ baseUrl: server.baseUrl, maxTokens: 'auto', contextTokenBudget: 'auto' })
      const story = await data.createStory({ characters: [], visualMode })
      await page.goto(`/stories/${story.id}`)
      await page.getByPlaceholder(/Escribe lo que haces/).fill('Saludo.')
      await page.getByRole('button', { name: 'Enviar', exact: true }).click()
      await expect.poll(async () => (await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })).length).toBe(1)
      const trace = (await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id }))[0]!
      expect(trace.status).toBe('success')
      expect(trace.request.max_tokens).toBe(8185)
      expect(trace.request.contextUsage).toMatchObject({ configuredLimit: 'auto', effectiveLimit: 4096, reservedTokens: 4096 })
      expect(server.chatRequests[0]?.max_tokens).toBe(8185)
    } finally { await server.close() }
  })
}

test('Auto fallido conserva borrador y no llama al narrador aunque contexto tokens esté desactivado', async ({ page, data }) => {
  await data.patchSettings({ maxTokens: 'auto', contextTokenBudget: 0 })
  const story = await data.createStory({ characters: [] })
  let generations = 0
  await page.route('**/api/llm/context', route => route.fulfill({ status: 409, json: { message: 'Modelo no cargado.' } }))
  await page.route('**/api/llm/chat', route => {
    generations += 1
    return route.fulfill({ json: { content: 'No debe generarse.', finishReason: 'stop' } })
  })
  await page.goto(`/stories/${story.id}`)
  await page.getByPlaceholder(/Escribe lo que haces/).fill('Borrador intacto.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Modelo no cargado.')
  await expect(page.getByPlaceholder(/Escribe lo que haces/)).toHaveValue('Borrador intacto.')
  expect(generations).toBe(0)
})

test('ambos Auto compactan con reserva y miden por separado resumen y respuesta', async ({ page, data }) => {
  const server = await startFakeLmStudio()
  try {
    await data.patchSettings({ baseUrl: server.baseUrl, maxTokens: 'auto', contextTokenBudget: 'auto' })
    const story = await data.createStory({ characters: [] })
    await data.createMessage({ story, role: 'assistant', raw: 'HISTORIAL_LARGO'.repeat(1000) })
    await page.route('**/api/llm/context', route => {
      const body = route.request().postDataJSON()
      const compaction = body.messages.some((message: { role: string; content: string }) =>
        message.role === 'user' && message.content.startsWith('{') && message.content.includes('"history"'))
      const tokens = !compaction && JSON.stringify(body.messages).includes('HISTORIAL_LARGO') ? 5000 : 7
      return route.fulfill({ json: { tokens, capacity: 8192, model: 'loaded-instance' } })
    })
    await page.goto(`/stories/${story.id}`)
    await page.getByPlaceholder(/Escribe lo que haces/).fill('MENSAJE_PENDIENTE')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect.poll(async () => (await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })).length).toBe(2)
    const traces = await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })
    const compaction = traces.find(trace => trace.request.purpose === 'compaction')!
    expect(compaction.request.compaction?.applied).toBe(true)
    expect(compaction.request.compaction?.beforeUsage?.effectiveLimit).toBe(4096)
    expect(compaction.request.max_tokens).toBe(8185)
    expect(server.chatRequests).toHaveLength(2)
    expect(JSON.stringify(server.chatRequests[0]?.messages)).not.toContain('MENSAJE_PENDIENTE')
    expect(JSON.stringify(server.chatRequests[1]?.messages)).toContain('MENSAJE_PENDIENTE')
  } finally { await server.close() }
})

test('respuesta tardía de capacidad no sustituye el modelo recién seleccionado', async ({ page }) => {
  let finishOld: (() => void) | undefined
  await page.route('**/api/llm/capacity?*', async route => {
    if (!finishOld) {
      await new Promise<void>(resolve => { finishOld = resolve })
      await route.fulfill({ json: { capacity: 8192, model: 'viejo' } }).catch(() => {})
    } else await route.fulfill({ json: { capacity: 32768, model: 'nuevo' } })
  })
  await page.goto('/settings#llm')
  await expect.poll(() => !!finishOld).toBe(true)
  await page.getByLabel('Modelo', { exact: true }).fill('nuevo')
  await expect(page.getByTestId('llm-token-capacity')).toContainText('32.768 tokens')
  finishOld!()
  await expect(page.getByTestId('llm-token-capacity')).toContainText('32.768 tokens')
})
