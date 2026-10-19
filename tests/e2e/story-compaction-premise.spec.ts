import type { Message, Story } from '../../shared/types'
import { test, expect } from './fixtures'

for (const scope of ['normal', 'private'] as const) {
  for (const visualMode of [false, true]) {
    test(`resumen antiguo sustituye planteamiento y bloquea editarlo (${scope}, ${visualMode ? 'Novela' : 'Chat'})`, async ({ page, data }) => {
      await data.patchSettings({ mockMode: false, model: 'test-model', useChromeLlm: false,
        privateUseChromeLlm: null, privateLlmSettingsEnabled: false, historyBudget: 100000,
        contextTokenBudget: 0, maxTokens: 100, responseSpeed: 'instant', visualNovelManualAdvance: false,
        narrativePrompt: 'Narra la historia.' })
      await page.route('**/api/llm/model-status?*', route => route.fulfill({ json: { loaded: true } }))
      const character = await data.createCharacter({ scope, name: 'Mara' })
      const premise = '  QA_PLANTEAMIENTO_ORIGINAL: aventura medieval sin magia.  '
      const story = await data.createStory({ title: 'QA: Planteamiento compactado', characters: [character], premise, scope, visualMode })
      const old = await data.createMessage({ story, scope, role: 'assistant', raw: 'HISTORIAL_YA_RESUMIDO',
        segments: [{ type: 'narration', text: 'HISTORIAL_YA_RESUMIDO' }] })
      const checkpoint = { ...story, contextSummary: 'Mara busca la llave en un mundo medieval sin magia.', contextSummaryThroughMessageId: old.id }
      const url = `/api/data/stories/${story.id}?scope=${scope}`
      await expect(await page.request.put(url, { data: checkpoint })).toBeOK()
      if (scope === 'private') {
        await page.goto('/')
        await page.locator('main').press('Control+Alt+p')
        await expect(page.locator('html')).toHaveClass(/private-scope/)
        await page.locator(`a[href="/stories/${story.id}"]`).first().click()
      } else await page.goto(`/stories/${story.id}`)
      await page.getByTestId('story-tools-toggle').click()
      await page.getByRole('button', { name: 'Ajustes de la historia', exact: true }).click()
      const form = page.getByRole('heading', { name: 'Ajustes de la historia', exact: true }).locator('..')
      const field = form.getByLabel('Planteamiento', { exact: true })
      await expect(field).toHaveAttribute('readonly', '')
      await expect(field).toHaveValue(premise)
      await expect(form).toContainText('El planteamiento no se puede modificar mientras haya un resumen activo')
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        await field.scrollIntoViewIfNeeded()
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
        expect(await form.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
        if (scope === 'normal') await page.screenshot({ path: `.data/issue-268-planteamiento-${visualMode ? 'novel' : 'chat'}-${width}.png`, animations: 'disabled' })
      }
      for (const summary of [checkpoint.contextSummary, '']) {
        const rejected = await page.request.put(url, { data: { ...checkpoint, premise: 'CAMBIO_RECHAZADO', contextSummary: summary } })
        expect(rejected.status()).toBe(409)
        expect(await rejected.text()).toContain('El planteamiento no se puede modificar')
      }
      await form.getByLabel('Título', { exact: true }).fill('QA: Título editable con resumen')
      await form.getByRole('button', { name: 'Guardar', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'QA: Título editable con resumen', exact: true })).toBeVisible()
      const stored = await data.get<Story>('stories', story.id, scope)
      expect(stored.premise).toBe(premise)
      expect(stored.contextSummary).toBe(checkpoint.contextSummary)
      let calls = 0
      await page.route('**/api/llm/chat', async route => {
        const request = route.request().postDataJSON()
        expect(request.operation).toBe('story.chat')
        expect(JSON.stringify(request.messages)).not.toContain('QA_PLANTEAMIENTO_ORIGINAL')
        expect(JSON.stringify(request.messages)).not.toContain('HISTORIAL_YA_RESUMIDO')
        expect(JSON.stringify(request.messages)).toContain(checkpoint.contextSummary)
        calls++
        await route.fulfill({ json: { content: 'La búsqueda continúa.', finishReason: 'stop' } })
      })
      await page.getByLabel('Tu intervención').fill('Busco la llave.')
      await page.getByRole('button', { name: 'Enviar', exact: true }).click()
      await expect(page.getByTestId(visualMode ? 'visual-novel-frame' : 'story-scroller')).toContainText('La búsqueda continúa.')
      expect(calls).toBe(1)
      expect((await data.list<Message>('messages', scope, { storyId: story.id })).find(message => message.id === old.id)?.raw).toBe(old.raw)
      // Quitar el resumen por separado libera el planteamiento; no borra mensajes.
      const current = await data.get<Story>('stories', story.id, scope)
      await expect(await page.request.put(url, { data: { ...current, contextSummary: '', contextSummaryThroughMessageId: undefined } })).toBeOK()
      await page.goto('/')
      if (scope === 'private') {
        await page.locator('main').press('Control+Alt+p')
        await expect(page.locator('html')).toHaveClass(/private-scope/)
      }
      await page.locator(`a[href="/stories/${story.id}"]`).first().click()
      await page.getByTestId('story-tools-toggle').click()
      await page.getByRole('button', { name: 'Ajustes de la historia', exact: true }).click()
      await expect(field).toBeEditable()
      await field.fill('QA: Planteamiento editable de nuevo.')
      await form.getByRole('button', { name: 'Guardar', exact: true }).click()
      await expect.poll(async () => (await data.get<Story>('stories', story.id, scope)).premise).toBe('QA: Planteamiento editable de nuevo.')
    })
  }
}

test('cargar partida restaura planteamiento y resumen juntos aunque el actual esté bloqueado', async ({ page, data }) => {
  await data.patchSettings({ mockMode: true })
  const story = await data.createStory({ characters: [], premise: 'Planteamiento de la partida.' })
  await data.createMessage({ story, role: 'assistant', raw: 'Pasado.', segments: [{ type: 'narration', text: 'Pasado.' }] })
  const created = await page.request.post(`/api/data/storySaves/${story.id}/create?scope=normal`, { data: { name: 'Partida anterior', thumbnailDataUrl: 'data:image/webp;base64,QA268' } })
  await expect(created).toBeOK()
  const save = await created.json()
  await expect(await page.request.put(`/api/data/stories/${story.id}?scope=normal`, { data: {
    ...story, premise: 'Planteamiento posterior.', contextSummary: 'Resumen posterior.'
  } })).toBeOK()
  await expect(await page.request.post(`/api/data/storySaves/${save.id}/load?scope=normal`)).toBeOK()
  const restored = await data.get<Story>('stories', story.id)
  expect(restored.premise).toBe(story.premise)
  expect(restored.contextSummary).toBeFalsy()
})
