import type { LlmDebugTrace, Message, Story } from '../../shared/types'
import { expect, test } from './fixtures'

for (const scope of ['normal', 'private'] as const) {
  for (const visualMode of [false, true]) {
    const width = visualMode ? 390 : 320
    test(`borra compactaciones en ${visualMode ? 'Novela Visual' : 'Chat'} ${scope} a ${width}px`, async ({ page, data }) => {
      await data.patchSettings({ mockMode: false, useChromeLlm: false, privateLlmSettingsEnabled: false,
        model: 'test-model', responseSpeed: 'instant', visualNovelManualAdvance: false,
        historyBudget: 40_000, narrativePrompt: 'Narra la historia.' })
      await page.route('**/api/llm/model-status?*', route => route.fulfill({ json: { status: 'loaded' } }))
      const story = await data.createStory({ characters: [], visualMode, scope })
      const old = await data.createMessage({ story, role: 'assistant', scope,
        raw: 'El faro conservaba una llave azul.', segments: [{ type: 'narration', text: 'El faro conservaba una llave azul.' }] })
      await expect(await page.request.put(`/api/data/stories/${story.id}?scope=${scope}`, {
        data: { ...story, contextSummary: 'RESUMEN_A_ELIMINAR', contextSummaryThroughMessageId: old.id }
      })).toBeOK()
      const traces = (['success', 'error'] as const).map((status): LlmDebugTrace => ({
        id: data.unique(status), storyId: story.id, requestMessageId: old.id, status, createdAt: Date.now(),
        request: { purpose: 'compaction', model: 'test', messages: [], temperature: 0.7, max_tokens: 100, stream: false,
          compaction: { before: [], historyBudget: 40_000, applied: status === 'success' } },
        response: status === 'success' ? { content: 'RESUMEN_A_ELIMINAR', finishReason: 'stop' } : { error: 'Resumen insuficiente.' }
      }))
      for (const trace of traces) {
        await expect(await page.request.put(`/api/data/llmDebugTraces/${trace.id}?scope=${scope}`, { data: trace })).toBeOK()
      }
      if (scope === 'private') {
        await page.goto('/settings')
        const trigger = page.getByRole('button', { name: 'Activar modo privado' })
        for (let click = 0; click < 3; click++) await trigger.click()
        await expect(page.locator('html')).toHaveClass(/private-scope/)
        await page.getByRole('link', { name: 'Historias', exact: true }).click()
        await page.getByRole('link', { name: story.title, exact: true }).click()
      } else await page.goto(`/stories/${story.id}`)
      await page.setViewportSize({ width, height: 900 })
      const showMenu = page.getByRole('button', { name: 'Mostrar menú de historia' })
      if (await showMenu.isVisible()) await showMenu.click()
      await page.getByTestId('story-tools-toggle').click()
      await page.getByTestId('story-debug-toggle').click()
      const markers = page.getByTestId(visualMode ? 'visual-compactions' : 'story-scroller')
      const applied = markers.locator(`[data-compaction-trace-id="${traces[0]!.id}"]`)
      const failed = markers.locator(`[data-compaction-trace-id="${traces[1]!.id}"]`)
      const dialog = page.getByRole('alertdialog', { name: 'Borrar compactación' })
      const originals = await data.list<Message>('messages', scope, { storyId: story.id })

      // Cancelar conserva tanto la traza como el resumen.
      await applied.getByRole('button', { name: 'Borrar compactación' }).click()
      await expect(dialog).toContainText('Los mensajes y los demás registros se conservarán')
      await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(applied.getByRole('button', { name: 'Borrar compactación' })).toBeFocused()
      expect((await data.get<Story>('stories', story.id, scope)).contextSummary).toBe('RESUMEN_A_ELIMINAR')

      await failed.getByRole('button', { name: 'Borrar compactación' }).click()
      await expect(dialog).toContainText('El resumen activo y los mensajes originales se conservarán')
      await dialog.getByRole('button', { name: 'Borrar', exact: true }).click()
      await expect(failed).toHaveCount(0)
      expect((await data.get<Story>('stories', story.id, scope)).contextSummary).toBe('RESUMEN_A_ELIMINAR')

      // Un fallo deja los datos intactos y permite reintentar.
      const deleteUrl = `**/api/data/stories/${story.id}/compactions/${traces[0]!.id}?scope=${scope}`
      await page.route(deleteUrl, route => route.fulfill({ status: 500, json: { message: 'Fallo de prueba.' } }))
      await applied.getByRole('button', { name: 'Borrar compactación' }).click()
      await dialog.getByRole('button', { name: 'Borrar', exact: true }).click()
      await expect(page.getByRole('alert')).toContainText('No se pudo borrar la compactación')
      await expect(applied).toBeVisible()
      expect((await data.get<Story>('stories', story.id, scope)).contextSummary).toBe('RESUMEN_A_ELIMINAR')
      await page.unroute(deleteUrl)
      await applied.getByRole('button', { name: 'Borrar compactación' }).click()
      await dialog.getByRole('button', { name: 'Borrar', exact: true }).click()
      await expect(applied).toHaveCount(0)
      const saved = await data.get<Story>('stories', story.id, scope)
      expect(saved.contextSummary).toBe('')
      expect(saved.contextSummaryThroughMessageId).toBeUndefined()
      expect(await data.list<Message>('messages', scope, { storyId: story.id })).toEqual(originals)
      expect(await data.list<LlmDebugTrace>('llmDebugTraces', scope, { storyId: story.id })).toHaveLength(0)

      // La siguiente petición usa el historial completo, sin el resumen borrado.
      const requests: Array<{ messages: Array<{ content: string }>; operation: string }> = []
      await page.route('**/api/llm/chat', async route => {
        requests.push(route.request().postDataJSON())
        await route.fulfill({ json: { content: 'La llave abre la puerta.', finishReason: 'stop' } })
      })
      const composer = page.getByPlaceholder(/Escribe lo que haces/)
      await composer.fill('Busco la llave.')
      await page.getByRole('button', { name: 'Enviar', exact: true }).click()
      await expect.poll(() => requests.length).toBe(1)
      expect(requests[0]!.operation).toBe('story.chat')
      expect(JSON.stringify(requests[0]!.messages)).toContain(old.raw)
      expect(JSON.stringify(requests[0]!.messages)).not.toContain('RESUMEN_A_ELIMINAR')
      await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled()
      await page.reload()
      expect((await data.get<Story>('stories', story.id, scope)).contextSummary).toBe('')
      expect((await data.list<LlmDebugTrace>('llmDebugTraces', scope, { storyId: story.id })).filter(trace => trace.request.purpose === 'compaction')).toHaveLength(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }
}

test('API rechaza trazas de otra historia y rutas incompletas sin borrar la historia', async ({ request, data }) => {
  const story = await data.createStory({ characters: [] })
  const other = await data.createStory({ characters: [] })
  const trace: LlmDebugTrace = {
    id: data.unique('trace'), storyId: other.id, status: 'success', createdAt: Date.now(),
    request: { purpose: 'compaction', model: 'test', messages: [], temperature: 0, max_tokens: 100, stream: false },
    response: { content: 'Resumen ajeno.', finishReason: 'stop' }
  }
  await expect(await request.put(`/api/data/llmDebugTraces/${trace.id}?scope=normal`, { data: trace })).toBeOK()
  for (const path of [`compactions/${trace.id}`, 'compactions', `compactions/${trace.id}/extra`]) {
    expect((await request.delete(`/api/data/stories/${story.id}/${path}?scope=normal`)).status()).toBe(404)
  }
  expect((await data.get<Story>('stories', story.id)).id).toBe(story.id)
  expect((await data.get<LlmDebugTrace>('llmDebugTraces', trace.id)).id).toBe(trace.id)
})
