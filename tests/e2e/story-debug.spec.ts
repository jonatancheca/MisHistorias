import type { LlmDebugTrace, Story } from '../../shared/types'
import { expect, test } from './fixtures'

for (const width of [320, 390, 1280]) {
  test(`Debug combina controles y originales sin hover a ${width}px`, async ({ page, data }) => {
    await data.patchSettings({ mockMode: true, responseSpeed: 'instant' })
    const story = await data.createStory({ characters: [] })
    const user = await data.createMessage({ story, role: 'user', raw: 'Entro [sigiloso].' })
    const hidden = await data.createMessage({ story, role: 'user', raw: 'IA: guarda [el secreto].' })
    const assistant = await data.createMessage({ story, role: 'assistant', raw: 'Respuesta [oculta].',
      segments: [{ type: 'narration', text: 'Respuesta [oculta].' }] })
    for (const status of ['success', 'error'] as const) {
      const trace: LlmDebugTrace = {
        id: data.unique('compaction'), storyId: story.id, requestMessageId: user.id,
        status, createdAt: Date.now(),
        request: { purpose: 'compaction', model: 'test', messages: [{ role: 'user', content: 'Historial antiguo.' }],
          temperature: 0.7, max_tokens: 100, stream: false },
        response: status === 'success' ? { content: 'Resumen antiguo.', finishReason: 'stop' } : { error: 'Compactación insuficiente.' }
      }
      await expect(await page.request.put(`/api/data/llmDebugTraces/${trace.id}?scope=normal`, { data: trace })).toBeOK()
    }
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`/stories/${story.id}`)
    const debug = page.getByTestId('story-debug-toggle')
    await expect(debug).toHaveAttribute('aria-pressed', 'false')
    const showMenu = page.getByRole('button', { name: 'Mostrar menú de historia' })
    if (width < 640 && await showMenu.isVisible()) await showMenu.click()
    await expect(page.getByTestId('story-compaction-marker')).toHaveCount(0)
    await debug.click()
    await expect(debug).toHaveAttribute('aria-pressed', 'true')
    const userBubble = page.locator(`[data-story-message-id="${user.id}"]`)
    const bubble = page.locator(`[data-story-message-id="${assistant.id}"]`)
    await page.mouse.move(0, 0)
    await expect(userBubble.getByRole('button', { name: 'Reenviar este mensaje' })).toBeVisible()
    await expect(bubble.getByRole('button', { name: 'Editar mensaje' })).toBeVisible()
    await expect(bubble.getByRole('button', { name: 'Editar mensaje' }).locator('..')).toHaveCSS('opacity', '1')
    await bubble.getByTestId('story-original-toggle').click()
    await expect(bubble.getByTestId('story-original-text')).toContainText(assistant.raw)
    await expect(page.getByTestId('story-compaction-marker')).toHaveCount(2)
    await expect(page.getByTestId('story-compaction-marker').first()).toContainText('Historial compactado')
    await expect(page.getByTestId('story-compaction-marker').last()).toContainText('Compactación fallida')
    await page.getByTestId('story-compaction-marker').first().getByRole('button').click()
    const dialog = page.getByRole('dialog', { name: 'Debug compactación' })
    await expect(dialog).toContainText('Esta traza antigua no conserva el contexto completo')
    await expect(dialog.getByTestId('compaction-summary')).toHaveText('Resumen antiguo.')
    await dialog.getByRole('button', { name: 'Cerrar debug LLM' }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await page.getByTestId('visual-mode-toggle').click()
    await expect(debug).toHaveAttribute('aria-pressed', 'true')
    const actions = page.getByTestId('visual-message-actions')
    await expect(actions).toBeVisible()
    await page.mouse.move(0, 0)
    await expect(actions).toHaveCSS('opacity', '1')
    await expect(actions.getByRole('button', { name: 'Borrar mensaje' })).toBeVisible()
    await expect(actions.getByRole('button', { name: 'Regenerar desde este mensaje' })).toBeVisible()
    await expect(page.getByTestId('visual-novel-view').getByTestId('story-original-text')).toContainText(assistant.raw)
    await actions.getByTestId('story-original-toggle').click()
    await expect(page.getByTestId('visual-compactions').getByTestId('story-compaction-marker')).toHaveCount(2)
    await page.getByRole('button', { name: 'Ver mensajes sin cuadro' }).click()
    const hiddenDialog = page.getByRole('dialog', { name: 'Mensajes sin cuadro' })
    const hiddenRow = hiddenDialog.locator(`[data-hidden-message-id="${hidden.id}"]`)
    await expect(hiddenRow.getByRole('button', { name: 'Reenviar este mensaje' })).toBeVisible()
    await hiddenRow.getByTestId('story-original-toggle').click()
    await expect(hiddenRow.getByTestId('story-original-text')).toContainText(hidden.raw)
    await hiddenRow.getByRole('button', { name: 'Editar mensaje' }).click()
    const editor = page.getByRole('dialog', { name: 'Editar mensaje', exact: true })
    await expect(editor.getByLabel('Texto completo del mensaje')).toHaveValue(hidden.raw)
    await editor.getByLabel('Texto completo del mensaje').fill('IA: nuevo [secreto].')
    await editor.getByRole('button', { name: 'Guardar' }).click()
    await expect(editor).toHaveCount(0)
    expect((await data.get<{ raw: string }>('messages', hidden.id)).raw).toBe('IA: nuevo [secreto].')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    if (width === 390) await page.screenshot({ path: test.info().outputPath('debug-novela-mobile.png') })
    await debug.click()
    await expect(page.getByTestId('story-compaction-marker')).toHaveCount(0)
    if (width < 640) await expect(actions).toBeHidden()
    await page.reload()
    await expect(debug).toHaveAttribute('aria-pressed', 'false')
  })
}

test('guarda contextos exactos con Debug apagado, conserva fallos y límite histórico', async ({ page, data }) => {
  await data.patchSettings({ mockMode: false, model: 'test-model', useChromeLlm: false,
    historyBudget: 40_000, responseSpeed: 'instant', narrativePrompt: 'NARRADOR: continúa.', compactionPrompt: null })
  const story = await data.createStory({ characters: [] })
  const old = await data.createMessage({ story, role: 'assistant', raw: 'Pasado importante. '.repeat(3500),
    segments: [{ type: 'narration', text: 'Pasado importante. '.repeat(3500) }] })
  let compactionCalls = 0
  let narratorMessages: Array<{ role: string; content: string }> = []
  await page.route('**/api/llm/chat', async (route) => {
    const request = route.request().postDataJSON()
    if (request.operation === 'story.compaction') {
      if (++compactionCalls === 1) return route.fulfill({ status: 502, json: { statusCode: 502, message: 'Compactador no disponible.' } })
      return route.fulfill({ json: { content: 'Resumen del pasado.', finishReason: 'stop' } })
    }
    narratorMessages = request.messages
    await route.fulfill({ json: { content: 'Respuesta tras compactar.', finishReason: 'stop' } })
  })
  await page.goto(`/stories/${story.id}`)
  const composer = page.getByPlaceholder(/Escribe lo que haces/)
  await composer.fill('Nueva intervención intacta.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByText('Compactador no disponible.', { exact: true })).toBeVisible()
  await expect(composer).toHaveValue('Nueva intervención intacta.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByText('Respuesta tras compactar.', { exact: true })).toBeVisible()
  const traces = (await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })).filter(trace => trace.request.purpose === 'compaction')
  expect(traces).toHaveLength(2)
  const failed = traces[0]!.request.compaction!
  const applied = traces[1]!.request.compaction!
  expect(failed).toMatchObject({ applied: false, historyBudget: 40_000 })
  expect(failed.after).toBeUndefined()
  expect(applied.applied).toBe(true)
  expect(applied.after).toEqual(narratorMessages)
  expect(applied.before.reduce((total, message) => total + message.content.length, 0)).toBeGreaterThan(40_000)
  expect(JSON.stringify(applied.before)).toContain(old.raw)
  expect(JSON.stringify(applied.before)).toContain('Nueva intervención intacta.')
  expect(JSON.stringify(applied.after)).not.toContain(old.raw)
  expect(JSON.stringify(applied.after)).toContain('Nueva intervención intacta.')
  await data.patchSettings({ historyBudget: 8000 })
  await page.reload()
  await page.getByTestId('story-debug-toggle').click()
  const marker = page.locator(`[data-compaction-trace-id="${traces[1]!.id}"]`)
  await marker.getByRole('button').click()
  const dialog = page.getByRole('dialog', { name: 'Debug compactación' })
  await expect(dialog.getByTestId('llm-debug-context-usage')).toContainText('/ 40000 caracteres')
  await expect(dialog.getByTestId('compaction-context-before')).toContainText('Nueva intervención intacta.')
  await expect(dialog.getByTestId('compaction-context-after')).toContainText('Resumen del pasado.')
  await expect(dialog.getByTestId('compaction-context-after')).toContainText('Nueva intervención intacta.')
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 760 })
    await expect(dialog).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await dialog.getByRole('button', { name: 'Cerrar debug LLM' }).click()
  await page.locator(`[data-compaction-trace-id="${traces[0]!.id}"]`).getByRole('button').click()
  await expect(dialog).toContainText('El checkpoint anterior se conservó.')
  await expect(dialog.getByTestId('compaction-context-after')).toContainText('No se obtuvo un contexto posterior.')
})

test('Debug móvil conserva solo lectura y no muestra compactaciones ajenas', async ({ page, data }) => {
  await data.patchSettings({ mockMode: true })
  const story = await data.createStory({ characters: [], visibleInDemo: true, visualMode: true })
  await data.createMessage({ story, role: 'assistant', raw: 'Texto [original] de lectura.',
    segments: [{ type: 'narration', text: 'Texto [original] de lectura.' }] })
  await page.route('**/api/data/stories?*', async route => {
    const response = await route.fetch()
    const stories = await response.json() as Story[]
    await route.fulfill({ response, json: stories.map(entry => entry.id === story.id ? { ...entry, readOnly: true } : entry) })
  })
  await page.setViewportSize({ width: 320, height: 760 })
  await page.goto(`/stories/${story.id}`)
  await page.getByRole('button', { name: 'Mostrar menú de historia' }).click()
  await page.getByTestId('story-debug-toggle').click()
  await expect(page.getByRole('button', { name: 'Editar mensaje' })).toHaveCount(0)
  await expect(page.getByTestId('story-compaction-marker')).toHaveCount(0)
  await page.getByTestId('visual-message-actions').getByTestId('story-original-toggle').click()
  await expect(page.getByTestId('visual-novel-view').getByTestId('story-original-text')).toContainText('Texto [original] de lectura.')
})
