import type { Page } from '@playwright/test'
import type { LlmDebugTrace, Message, Story } from '../../shared/types'
import { test, expect, type TestDataFactory } from './fixtures'

test.beforeEach(async ({ page, data }) => {
  await data.patchSettings({ mockMode: true, model: 'test-model', useChromeLlm: false,
    privateUseChromeLlm: null, privateLlmSettingsEnabled: false, historyBudget: 100000,
    contextTokenBudget: 0, maxTokens: 100, responseSpeed: 'instant', narrativePrompt: 'Narra la historia.' })
  await page.route('**/api/llm/model-status?*', route => route.fulfill({ json: { loaded: true } }))
})

async function prepare(page: Page, data: TestDataFactory, scope: 'normal' | 'private' = 'normal', visualMode = false) {
  const story = await data.createStory({ title: 'QA: El faro y la llave azul', characters: [], scope, visualMode })
  const old = await data.createMessage({ story, scope, role: 'assistant', raw: 'HISTORIA_ORIGINAL. '.repeat(100),
    segments: [{ type: 'narration', text: 'El faro conserva una llave azul.' }] })
  await expect(await page.request.put(`/api/data/stories/${story.id}?scope=${scope}`, { data: {
    ...story, contextSummary: 'Resumen vigente.', contextSummaryThroughMessageId: old.id
  } })).toBeOK()
  if (scope === 'private') {
    await page.goto('/')
    await page.locator('main').press('Control+Alt+p')
    await expect(page.locator('html')).toHaveClass(/private-scope/)
    await page.locator(`a[href="/stories/${story.id}"]`).first().click()
  } else await page.goto(`/stories/${story.id}`)
  return { story, old }
}

async function openEditor(page: Page) {
  await page.locator('[data-testid^="story-context-"]').first().click()
  const history = page.getByRole('dialog', { name: 'Compactaciones de la historia', exact: true })
  await history.getByRole('button', { name: 'Escribir resumen', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Escribir resumen', exact: true })
  await expect(editor).toBeVisible()
  await expect(history).toBeHidden()
  return editor
}

for (const scope of ['normal', 'private'] as const) {
  for (const visualMode of [false, true]) {
    test(`guarda resumen acumulado sin IA, conserva pendientes y permite inspección (${scope}, ${visualMode ? 'Novela' : 'Chat'})`, async ({ page, data }) => {
      const { story } = await prepare(page, data, scope, visualMode)
      const last = await data.createMessage({ story, scope, role: 'assistant', raw: 'Hechos posteriores. '.repeat(100),
        segments: [{ type: 'narration', text: 'La llave abre la puerta del faro.' }] })
      const pending = await data.createMessage({ story, scope, role: 'user', raw: 'PENDIENTE_NO_RESUMIDO' })
      if (scope === 'normal') await page.reload()
      else {
        await page.getByRole('link', { name: 'Historias', exact: true }).click()
        await page.locator(`a[href="/stories/${story.id}"]`).first().click()
      }
      let llmCalls = 0
      await page.route('**/api/llm/chat', route => { llmCalls++; return route.fulfill({ status: 500 }) })
      await page.route('**/api/llm/context', route => { llmCalls++; return route.fulfill({ status: 500 }) })
      const composer = page.getByLabel('Tu intervención')
      await composer.fill('BORRADOR_CONSERVADO')
      const editor = await openEditor(page)
      const field = editor.getByLabel('Resumen escrito a mano', { exact: true })
      await expect(field).toHaveValue('Resumen vigente.')
      const summary = 'La llave azul abre la puerta del faro. El grupo decide entrar.'
      await field.fill(summary)
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        await expect(editor.getByRole('button', { name: 'Guardar resumen', exact: true })).toBeEnabled()
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
        expect(await field.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
        if (scope === 'normal') await page.screenshot({ path: `.data/issue-267-editor-${visualMode ? 'novel' : 'chat'}-${width}.png`, animations: 'disabled' })
      }
      await editor.getByRole('button', { name: 'Guardar resumen', exact: true }).click()
      await expect(editor).toContainText('Resumen guardado. No se ha generado ninguna continuación.')
      await expect(editor).toContainText('Tokens sin verificar.')
      expect(llmCalls).toBe(0)
      const stored = await data.get<Story>('stories', story.id, scope)
      expect(stored).toMatchObject({ contextSummary: summary, contextSummaryThroughMessageId: last.id })
      const messages = await data.list<Message>('messages', scope, { storyId: story.id })
      expect(messages).toHaveLength(3)
      expect(messages.at(-1)?.id).toBe(pending.id)
      const traces = await data.list<LlmDebugTrace>('llmDebugTraces', scope, { storyId: story.id })
      expect(traces).toHaveLength(1)
      expect(traces[0]!.request).toMatchObject({ origin: 'user', purpose: 'compaction', compaction: { applied: true, tokensVerified: false } })
      expect(traces[0]!.request).not.toHaveProperty('model')
      expect(traces[0]!.request).not.toHaveProperty('provider')
      expect(traces[0]!.request).not.toHaveProperty('messages')
      await editor.getByRole('button', { name: 'Cerrar diálogo' }).click()
      await expect(composer).toHaveValue('BORRADOR_CONSERVADO')
      const ring = page.locator('[data-testid^="story-context-"]').first()
      await expect(ring).toBeFocused()
      await expect(ring).toHaveAttribute('aria-label', /Compactada 1 vez$/)
      await ring.click()
      const history = page.getByRole('dialog', { name: 'Compactaciones de la historia', exact: true })
      await expect(history.getByTestId('story-compaction-marker')).toContainText('Resumen escrito a mano')
      if (scope === 'normal') await page.screenshot({ path: `.data/issue-267-history-${visualMode ? 'novel' : 'chat'}.png`, animations: 'disabled' })
      await history.getByRole('button', { name: 'Ver antes / después' }).click()
      const detail = page.getByRole('dialog', { name: 'Resumen escrito a mano', exact: true })
      await expect(detail).toContainText('Guardado por el usuario')
      await expect(detail.getByTestId('compaction-summary')).toHaveText(summary)
      await expect(detail).not.toContainText('Petición al compactador')
      await expect(detail).not.toContainText('Respuesta recibida')
      await expect(detail.getByTestId('compaction-context-before')).toContainText('La llave abre la puerta del faro.')
      await expect(detail.getByTestId('compaction-context-after')).toContainText(summary)
      await expect(detail.getByTestId('compaction-context-after')).not.toContainText('La llave abre la puerta del faro.')
      if (scope === 'normal') {
        await page.reload()
        await openEditor(page)
        await expect(page.getByLabel('Resumen escrito a mano', { exact: true })).toHaveValue(summary)
      }
    })
  }
}

test('fallo de guardado conserva editor, checkpoint e historial; cerrar exige descartar cambios', async ({ page, data }) => {
  const { story } = await prepare(page, data)
  const editor = await openEditor(page)
  const field = editor.getByLabel('Resumen escrito a mano', { exact: true })
  await field.fill('Resumen corregido por el usuario.')
  const url = `**/api/data/stories/${story.id}/compactions?scope=normal`
  await page.route(url, route => route.fulfill({ status: 500, json: { message: 'No se pudo guardar el resumen.' } }))
  await editor.getByRole('button', { name: 'Guardar resumen', exact: true }).click()
  await expect(editor.getByRole('alert')).toHaveText('No se pudo guardar el resumen.')
  await expect(field).toHaveValue('Resumen corregido por el usuario.')
  expect((await data.get<Story>('stories', story.id)).contextSummary).toBe('Resumen vigente.')
  expect(await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })).toHaveLength(0)
  await page.keyboard.press('Escape')
  const discard = page.getByRole('alertdialog', { name: 'Descartar resumen sin guardar' })
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(editor).toBeVisible()
  await expect(field).toHaveValue('Resumen corregido por el usuario.')
  await page.keyboard.press('Escape')
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: 'Descartar cambios', exact: true }).click()
  await expect(editor).toBeHidden()
  expect((await data.get<Story>('stories', story.id)).contextSummary).toBe('Resumen vigente.')
})

test('admite ampliar resumen y la siguiente petición utiliza el texto nuevo sin el historial sustituido', async ({ page, data }) => {
  const { story } = await prepare(page, data)
  const editor = await openEditor(page)
  const summary = 'Resumen ampliado y corregido a mano. '.repeat(10)
  await editor.getByLabel('Resumen escrito a mano', { exact: true }).fill(summary)
  await expect(editor).toContainText('Este resumen no reduce el contexto.')
  await editor.getByRole('button', { name: 'Guardar resumen', exact: true }).click()
  await expect(editor).toContainText('Resumen guardado.')
  await data.patchSettings({ mockMode: false })
  await page.route('**/api/llm/context', route => route.fulfill({ json: { tokens: 500, capacity: 30000, model: 'test-model' } }))
  let sent: Array<{ content: string }> = []
  await page.route('**/api/llm/chat', route => {
    const body = route.request().postDataJSON()
    expect(body.operation).toBe('story.chat')
    sent = body.messages
    return route.fulfill({ json: { content: 'El grupo sube las escaleras.', finishReason: 'stop' } })
  })
  await page.reload()
  await page.getByLabel('Tu intervención').fill('Entramos en el faro.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect.poll(() => sent.length).toBeGreaterThan(0)
  expect(JSON.stringify(sent)).toContain(summary.trim())
  expect(JSON.stringify(sent)).not.toContain('HISTORIA_ORIGINAL')
  expect((await data.get<Story>('stories', story.id)).contextSummary).toBe(summary.trim())
})

test('bloquea vacío e historia sin respuesta del Narrador y respeta solo lectura', async ({ page, data }) => {
  const story = await data.createStory({ characters: [] })
  await data.createMessage({ story, role: 'user', raw: 'Intervención pendiente.' })
  await page.goto(`/stories/${story.id}`)
  const editor = await openEditor(page)
  const field = editor.getByLabel('Resumen escrito a mano', { exact: true })
  await expect(editor.getByRole('button', { name: 'Guardar resumen', exact: true })).toBeDisabled()
  await field.fill('Resumen que todavía no corresponde a ninguna respuesta.')
  await expect(editor).toContainText('No hay historial anterior que resumir.')
  await expect(editor.getByRole('button', { name: 'Guardar resumen', exact: true })).toBeDisabled()
  await page.route('**/api/data/stories?scope=normal', async route => {
    const response = await route.fetch()
    const stories = await response.json() as Story[]
    await route.fulfill({ json: stories.map(value => value.id === story.id ? { ...value, readOnly: true } : value) })
  })
  await page.reload()
  await expect(page.getByText('Solo lectura', { exact: true })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Ocupación del contexto' })).toHaveCount(0)
})

test('bloquea límite de caracteres conocido y tokens medidos excedidos', async ({ page, data }) => {
  await prepare(page, data)
  await data.patchSettings({ historyBudget: 1 })
  await page.reload()
  let editor = await openEditor(page)
  await editor.getByLabel('Resumen escrito a mano', { exact: true }).fill('Resumen demasiado largo.')
  await expect(editor.getByRole('alert')).toContainText('supera el límite de caracteres')
  await expect(editor.getByRole('button', { name: 'Guardar resumen', exact: true })).toBeDisabled()
  await data.patchSettings({ mockMode: false, historyBudget: 100000, contextTokenBudget: 1000 })
  await page.route('**/api/llm/context', route => route.fulfill({ json: { tokens: 1200, capacity: 30000, model: 'test-model' } }))
  await page.reload()
  editor = await openEditor(page)
  await editor.getByLabel('Resumen escrito a mano', { exact: true }).fill('Resumen con tokens medidos.')
  await editor.getByRole('button', { name: 'Guardar resumen', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('1200 tokens y el límite es 1000')
  await expect(editor).not.toContainText('Resumen guardado.')
})

test('sin tokenizador permite guardar con límite de tokens activo y marca tokens sin verificar', async ({ page, data }) => {
  const { story } = await prepare(page, data)
  await data.patchSettings({ mockMode: false, contextTokenBudget: 1000 })
  await page.route('**/api/llm/context', route => route.fulfill({ status: 502, json: { message: 'Tokenizador no disponible.' } }))
  await page.reload()
  const editor = await openEditor(page)
  await editor.getByLabel('Resumen escrito a mano', { exact: true }).fill('Resumen guardado sin tokenizador.')
  await editor.getByRole('button', { name: 'Guardar resumen', exact: true }).click()
  await expect(editor).toContainText('Resumen guardado.')
  await expect(editor).toContainText('Tokens sin verificar.')
  expect((await data.get<Story>('stories', story.id)).contextSummary).toBe('Resumen guardado sin tokenizador.')
})

test('rechaza historia modificada durante el guardado y conserva el texto escrito', async ({ page, data }) => {
  const { story } = await prepare(page, data)
  const editor = await openEditor(page)
  await editor.getByLabel('Resumen escrito a mano', { exact: true }).fill('Resumen preparado antes del cambio.')
  await page.route(`**/api/data/stories/${story.id}/compactions?scope=normal`, async route => {
    const current = await data.get<Story>('stories', story.id)
    await expect(await page.request.put(`/api/data/stories/${story.id}?scope=normal`, { data: { ...current, updatedAt: current.updatedAt + 1 } })).toBeOK()
    await route.continue()
  })
  await editor.getByRole('button', { name: 'Guardar resumen', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('La historia ha cambiado.')
  await expect(editor.getByLabel('Resumen escrito a mano', { exact: true })).toHaveValue('Resumen preparado antes del cambio.')
  expect((await data.get<Story>('stories', story.id)).contextSummary).toBe('Resumen vigente.')
})


test('Chrome sin modelo guarda a mano sin descargar ni generar', async ({ page, data }) => {
  await data.patchSettings({ mockMode: false, useChromeLlm: true, historyBudget: 0 })
  await page.addInitScript(() => {
    Object.defineProperty(window, 'writtenSummaryChromeCreates', { configurable: true, value: 0, writable: true })
    const api = {
      async availability() { return 'downloadable' },
      async create() {
        const state = window as unknown as { writtenSummaryChromeCreates: number }
        state.writtenSummaryChromeCreates++
        throw new Error('No debe descargar ni abrir sesiones para escribir el resumen.')
      }
    }
    Object.defineProperty(window, 'LanguageModel', { configurable: true, value: api })
  })
  const { story } = await prepare(page, data)
  const editor = await openEditor(page)
  await editor.getByLabel('Resumen escrito a mano', { exact: true }).fill('Resumen escrito sin modelo de Chrome.')
  await editor.getByRole('button', { name: 'Guardar resumen', exact: true }).click()
  await expect(editor).toContainText('Resumen guardado.')
  await expect(editor).toContainText('Tokens sin verificar.')
  expect(await page.evaluate(() => (window as unknown as { writtenSummaryChromeCreates: number }).writtenSummaryChromeCreates)).toBe(0)
  expect((await data.get<Story>('stories', story.id)).contextSummary).toBe('Resumen escrito sin modelo de Chrome.')
})
