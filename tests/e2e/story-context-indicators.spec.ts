import type { LlmDebugTrace, Story } from '../../shared/types'
import { test, expect } from './fixtures'

test.beforeEach(async ({ page, data }) => {
  await data.patchSettings({ mockMode: false, model: 'test-model', useChromeLlm: false,
    privateUseChromeLlm: null, privateLlmSettingsEnabled: false,
    contextTokenBudget: 3000, historyBudget: 12000, maxTokens: 100,
    narrativePrompt: 'Narra la historia.', responseSpeed: 'instant' })
  await page.route('**/api/llm/model-status?*', route => route.fulfill({ json: { loaded: true } }))
})

test('mide sin bloquear, excluye borrador y muestra limites efectivos en ambos modos, móviles y tablets', async ({ page, data }) => {
  const story = await data.createStory({ characters: [] })
  await data.createMessage({ story, role: 'assistant', raw: 'La luz del faro vuelve a encenderse.' })
  let release: (() => void) | undefined
  const pending = new Promise<void>(resolve => { release = resolve })
  let calls = 0
  let characters = 0
  await page.route('**/api/llm/context', async route => {
    calls += 1
    const { messages } = route.request().postDataJSON()
    characters = messages.reduce((sum: number, message: { content: string }) => sum + message.content.length, 0)
    expect(JSON.stringify(messages)).not.toContain('BORRADOR_NO_ENVIADO')
    await pending
    await route.fulfill({ json: { tokens: 500, capacity: 1100, model: 'test-instance' } })
  })
  await page.goto(`/stories/${story.id}`)
  await expect.poll(() => calls).toBe(1)
  await expect(page.getByRole('heading', { name: story.title })).toBeVisible()
  await page.getByLabel('Tu intervención').fill('BORRADOR_NO_ENVIADO')
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled()
  await expect(page.getByTestId('story-context-tokens')).toBeVisible()
  await expect(page.getByTestId('story-context-tokens')).toHaveAttribute('data-state', 'measuring')
  await expect(page.getByTestId('story-context-tokens')).toHaveAttribute('aria-label', /Midiendo…/)
  await expect(page.getByTestId('story-context-tokens').locator('[stroke-dasharray]')).toHaveCount(0)
  release!()
  const tokens = page.getByTestId('story-context-tokens')
  const chars = page.getByTestId('story-context-characters')
  await expect(tokens).toHaveAttribute('aria-label', 'Contexto (tokens): 50 % ocupado · 500 / 1000 · Compactada 0 veces')
  await expect(chars).toHaveAttribute('aria-label', new RegExp(`${characters.toLocaleString('es-ES')} / 12[.]000`))
  await tokens.press('Tab')
  await chars.press('Shift+Tab')
  await expect(tokens).toBeFocused()
  await expect(tokens.getByRole('tooltip')).toBeVisible()
  await expect(tokens.getByRole('tooltip')).toHaveText('Contexto (tokens): 50 % ocupado · 500 / 1000 · Compactada 0 veces')
  await page.getByLabel('Tu intervención').fill('Otro borrador.')
  expect(calls).toBe(1)

  for (const visual of [false, true]) {
    if (visual) await page.getByTestId('visual-mode-toggle').click()
    for (const width of [320, 390, 639, 640, 768, 1024, 1280]) {
      await page.setViewportSize({ width, height: width === 1024 ? 768 : 844 })
      await expect(tokens).toBeVisible()
      await expect(chars).toBeVisible()
      await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.story-context-indicator')].every(el => {
        const r = el.getBoundingClientRect()
        return r.left >= 0 && r.right <= innerWidth
      }))).toBe(true)
      const geometry = await page.evaluate(() => {
        const mobile = innerWidth < 640
        const options = document.querySelector(mobile ? '#story-mobile-context' : '#story-reader-options')!
        const preceding = document.querySelector(mobile ? '#story-header h1' : '#story-reader-options [data-testid="story-tools-toggle"]')!.getBoundingClientRect()
        const rings = [...options.querySelectorAll('.story-context-indicator')].map(el => {
          const r = el.getBoundingClientRect()
          return { width: r.width, height: r.height, left: r.left, right: r.right }
        })
        return { precedingRight: preceding.right, viewport: innerWidth, rings }
      })
      expect(geometry.rings).toHaveLength(2)
      for (const ring of geometry.rings) {
        expect(ring.width).toBe(16)
        expect(ring.height).toBe(16)
        expect(ring.left).toBeGreaterThanOrEqual(geometry.precedingRight)
        expect(ring.right).toBeLessThanOrEqual(geometry.viewport)
      }
      if (width < 640) {
        await tokens.focus()
        await expect(tokens.getByRole('tooltip')).toBeVisible()
        const tooltip = await tokens.getByRole('tooltip').boundingBox()
        expect(tooltip!.x).toBeGreaterThanOrEqual(0)
        expect(tooltip!.y).toBeGreaterThanOrEqual(0)
        expect(tooltip!.x + tooltip!.width).toBeLessThanOrEqual(width)
        await page.screenshot({ path: `.data/context-${visual ? 'novel' : 'chat'}-${width}.png` })
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    }
  }
  await page.screenshot({ path: '.data/issue-240-novel.png' })
})

test('limites desactivados no consultan tokens; fallo conserva anillo sin reintentar hasta volver a entrar', async ({ page, data }) => {
  await page.clock.install()
  const story = await data.createStory({ characters: [] })
  const message = await data.createMessage({ story, role: 'assistant', raw: 'Hecho anterior.',
    segments: [{ type: 'narration', text: 'Hecho anterior.' }] })
  let calls = 0
  let failing = true
  await page.route('**/api/llm/context', route => {
    calls += 1
    return failing
      ? route.fulfill({ status: 502, json: { message: 'Tokenizador no disponible.' } })
      : route.fulfill({ json: { tokens: 500, capacity: 1100, model: 'test-instance' } })
  })
  await data.patchSettings({ contextTokenBudget: 0 })
  await page.goto(`/stories/${story.id}`)
  await expect(page.getByTestId('story-context-characters')).toBeVisible()
  await expect(page.getByTestId('story-context-tokens')).toHaveCount(0)
  expect(calls).toBe(0)
  await data.patchSettings({ contextTokenBudget: 3000 })
  await page.reload()
  await expect.poll(() => calls).toBeGreaterThan(0)
  await expect(page.getByTestId('story-context-characters')).toBeVisible()
  const tokens = page.getByTestId('story-context-tokens')
  await expect(tokens).toBeVisible()
  await expect(tokens).toHaveAttribute('data-state', 'unavailable')
  await expect(tokens).toHaveAttribute('aria-label', /No disponible[.] Tokenizador no disponible[.]/)
  await expect(tokens).not.toHaveAttribute('aria-label', /%/)
  await expect(tokens.locator('[stroke-dasharray]')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  const failedCalls = calls
  failing = false
  const characters = page.getByTestId('story-context-characters')
  const previousCharacters = await characters.getAttribute('aria-label')
  await page.getByRole('button', { name: 'Editar mensaje', exact: true }).click()
  const editor = page.locator(`[data-story-message-id="${message.id}"] form`)
  await editor.locator('textarea').fill('Hecho anterior ampliado con nuevos detalles de la historia.')
  await editor.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(characters).not.toHaveAttribute('aria-label', previousCharacters!)
  await page.getByTestId('visual-mode-toggle').click()
  await expect(page.getByTestId('visual-novel-view')).toBeVisible()
  await page.clock.fastForward(35_000)
  await expect(tokens).toHaveAttribute('data-state', 'unavailable')
  await expect(page.getByTestId('story-context-characters')).toBeVisible()
  expect(calls).toBe(failedCalls)
  await tokens.click()
  const history = page.getByRole('dialog', { name: 'Compactaciones de la historia' })
  await expect(history).toContainText('No hay compactaciones conservadas')
  await history.getByRole('button', { name: 'Cerrar diálogo' }).click()
  await page.getByRole('link', { name: 'Historias', exact: true }).click()
  await page.locator(`a[href="/stories/${story.id}"]`).first().click()
  await expect(tokens).toHaveAttribute('data-state', 'measured')
  await expect(tokens).toHaveAttribute('aria-label', /50 % ocupado · 500 \/ 1000/)
  expect(calls).toBeGreaterThan(failedCalls)
  await data.patchSettings({ contextTokenBudget: 0, historyBudget: 0 })
  const before = calls
  await page.reload()
  await expect(page.getByRole('heading', { name: story.title })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Ocupación del contexto' })).toHaveCount(0)
  expect(calls).toBe(before)
})

test('Auto conserva motivo y circulo neutro en Chat y Novela Visual sin overflow', async ({ page, data }) => {
  await data.patchSettings({ contextTokenBudget: 'auto', maxTokens: 'auto', historyBudget: 0 })
  const story = await data.createStory({ title: 'El faro y la llave azul', characters: [] })
  await data.createMessage({ story, role: 'assistant', raw: 'La luz del faro vuelve a encenderse.',
    segments: [{ type: 'narration', text: 'La luz del faro vuelve a encenderse.' }] })
  await page.route('**/api/llm/context', route => route.fulfill({ json: { tokens: 100, capacity: 4096, model: 'test-instance' } }))
  await page.goto(`/stories/${story.id}`)
  const tokens = page.getByTestId('story-context-tokens')
  await expect(tokens).toHaveAttribute('data-state', 'unavailable')
  await expect(tokens).toHaveAttribute('aria-label', /Los tokens máximos de respuesta ocupan toda la capacidad del modelo/)
  await expect(tokens).not.toHaveAttribute('aria-label', /%/)
  await expect(page.getByTestId('story-context-characters')).toHaveCount(0)
  for (const visual of [false, true]) {
    if (visual) await page.getByTestId('visual-mode-toggle').click()
    for (const width of [320, 390, 639, 640, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 })
      await tokens.hover()
      await expect(tokens.getByRole('tooltip')).toBeVisible()
      const tooltip = await tokens.getByRole('tooltip').boundingBox()
      expect(tooltip!.x).toBeGreaterThanOrEqual(0)
      expect(tooltip!.x + tooltip!.width).toBeLessThanOrEqual(width)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
      if ([390, 1280].includes(width)) {
        await page.screenshot({ path: `.data/issue-254-${visual ? 'novel' : 'chat'}-${width}.png`, animations: 'disabled' })
      }
    }
  }
})

test('Chrome conserva fallo sin nuevas sesiones y mide al volver a entrar', async ({ page, data }) => {
  await data.patchSettings({ useChromeLlm: true, contextTokenBudget: 'auto', historyBudget: 0 })
  await page.addInitScript(() => {
    const state = { failing: true, calls: 0 }
    class FakeLanguageModel {
      contextWindow = 2048
      contextUsage = 0
      static async availability() { return 'available' }
      static async create() { state.calls += 1; return new FakeLanguageModel() }
      async measureContextUsage() {
        if (state.failing) throw new Error('Tokenizador Chrome no disponible.')
        return 512
      }
      destroy() {}
    }
    Object.defineProperty(globalThis, 'LanguageModel', { configurable: true, value: FakeLanguageModel })
    Object.defineProperty(globalThis, 'chromeMeasurement', { value: state })
  })
  const story = await data.createStory({ characters: [] })
  await page.goto(`/stories/${story.id}`)
  const tokens = page.getByTestId('story-context-tokens')
  await expect(tokens).toHaveAttribute('data-state', 'unavailable')
  await expect(tokens).toHaveAttribute('aria-label', /Tokenizador Chrome no disponible[.]/)
  const failedCalls = await page.evaluate(() => (globalThis as unknown as { chromeMeasurement: { calls: number } }).chromeMeasurement.calls)
  await page.evaluate(() => { (globalThis as unknown as { chromeMeasurement: { failing: boolean } }).chromeMeasurement.failing = false })
  await page.getByTestId('visual-mode-toggle').click()
  await expect(page.getByTestId('visual-novel-view')).toBeVisible()
  await expect(tokens).toHaveAttribute('data-state', 'unavailable')
  expect(await page.evaluate(() => (globalThis as unknown as { chromeMeasurement: { calls: number } }).chromeMeasurement.calls)).toBe(failedCalls)
  await page.getByRole('link', { name: 'Historias', exact: true }).click()
  await page.locator(`a[href="/stories/${story.id}"]`).first().click()
  await expect(tokens).toHaveAttribute('aria-label', /25 % ocupado · 512 \/ 2048/)
  await expect(tokens).toHaveAttribute('data-state', 'measured')
})

test('refresca tras generar y compactar', async ({ page, data }) => {
  const story = await data.createStory({ characters: [] })
  await data.createMessage({ story, role: 'assistant', raw: 'Hecho anterior. '.repeat(250) })
  await page.route('**/api/llm/context', route => {
    const { messages } = route.request().postDataJSON()
    const tokens = messages.reduce((sum: number, message: { content: string }) => sum + Math.ceil(message.content.length / 4), 0)
    return route.fulfill({ json: { tokens, capacity: 30000, model: 'test-instance' } })
  })
  await page.route('**/api/llm/chat', route => route.fulfill({ json: {
    content: route.request().postDataJSON().operation === 'story.compaction' ? 'Resumen breve.' : 'Nueva respuesta del narrador.',
    finishReason: 'stop'
  } }))
  await page.goto(`/stories/${story.id}`)
  const ring = page.getByTestId('story-context-tokens')
  await expect(ring).toBeVisible()
  const before = await ring.getAttribute('aria-label')
  await page.getByLabel('Tu intervención').fill('Avanzo hacia el faro.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByText('Nueva respuesta del narrador.', { exact: true })).toBeVisible()
  await expect(ring).toBeVisible()
  await expect(ring).not.toHaveAttribute('aria-label', before!)
  const afterGeneration = await ring.getAttribute('aria-label')
  await page.getByTestId('story-tools-toggle').click()
  await page.getByRole('button', { name: 'Compactar historia', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Compactar historia', exact: true })
  await expect(dialog.getByRole('button', { name: 'Compactar', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Compactar', exact: true }).click()
  await expect(dialog.getByTestId('manual-compaction-after')).toBeVisible()
  await expect(ring).toBeVisible()
  await expect(ring).not.toHaveAttribute('aria-label', afterGeneration!)
  await expect(ring).toHaveAttribute('aria-label', /Compactada 1 vez$/)
})

test('oculta indicadores en solo lectura y no consulta tokens', async ({ page, data }) => {
  const story = await data.createStory({ characters: [] })
  let calls = 0
  await page.route('**/api/llm/context', route => { calls += 1; return route.fulfill({ status: 500 }) })
  await page.route('**/api/data/stories?scope=normal', async route => {
    const response = await route.fetch()
    const stories = await response.json() as Story[]
    await route.fulfill({ json: stories.map(value => value.id === story.id ? { ...value, readOnly: true } : value) })
  })
  await page.goto(`/stories/${story.id}`)
  await expect(page.getByText('Solo lectura', { exact: true })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Ocupación del contexto' })).toHaveCount(0)
  expect(calls).toBe(0)
})

test('móvil y tablet táctiles muestran ambos anillos y abren historial al tocar', async ({ browser, data }) => {
  const story = await data.createStory({ characters: [], visualMode: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const tablet = await context.newPage()
  try {
    await tablet.route('**/api/llm/model-status?*', route => route.fulfill({ json: { loaded: true } }))
    await tablet.route('**/api/llm/context', route => route.fulfill({ json: { tokens: 750, capacity: 30000, model: 'test-instance' } }))
    await tablet.goto(`/stories/${story.id}`)
    expect(await tablet.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
    for (const width of [320, 390, 1024]) {
      await tablet.setViewportSize({ width, height: 844 })
      await expect(tablet.getByTestId('story-context-tokens')).toBeVisible()
      await expect(tablet.getByTestId('story-context-characters')).toBeVisible()
      await tablet.getByTestId('story-context-tokens').tap()
      const history = tablet.getByRole('dialog', { name: 'Compactaciones de la historia' })
      await expect(history).toBeVisible()
      await expect(history).toContainText('No hay compactaciones conservadas')
      expect(await tablet.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
      await tablet.screenshot({ path: `.data/context-touch-${width}.png` })
      await history.getByRole('button', { name: 'Cerrar diálogo' }).tap()
    }
  } finally {
    await context.close()
  }
})


test('ignora medicion tardia cuando otra actualizacion ya obtuvo resultados', async ({ page, data }) => {
  const story = await data.createStory({ characters: [] })
  let release: (() => void) | undefined
  const pending = new Promise<void>(resolve => { release = resolve })
  let calls = 0
  await page.route('**/api/llm/context', async route => {
    const first = ++calls === 1
    if (first) await pending
    await route.fulfill({ json: { tokens: first ? 900 : 200, capacity: 1100, model: 'test-instance' } }).catch(() => {})
  })
  await page.goto(`/stories/${story.id}`)
  await expect.poll(() => calls).toBe(1)
  await page.getByTestId('visual-mode-toggle').click()
  const ring = page.getByTestId('story-context-tokens')
  const label = 'Contexto (tokens): 20 % ocupado · 200 / 1000 · Compactada 0 veces'
  await expect(ring).toHaveAttribute('aria-label', label)
  release!()
  await page.getByLabel('Tu intervención').fill('Borrador conservado.')
  await expect(ring).toHaveAttribute('aria-label', label)
  await expect(page.getByLabel('Tu intervención')).toHaveValue('Borrador conservado.')
})

test('usa limites y modelo privados; porcentaje mayor de 100 no altera el limite', async ({ page, data }) => {
  await data.patchSettings({ privateLlmSettingsEnabled: true, privateModel: 'private-model',
    privateContextTokenBudget: 1500, privateHistoryBudget: 20000, privateMaxTokens: 50 })
  const story = await data.createStory({ characters: [], scope: 'private' })
  await page.route('**/api/llm/context', route => {
    expect(route.request().postDataJSON()).toMatchObject({ scope: 'private', model: 'private-model' })
    return route.fulfill({ json: { tokens: 900, capacity: 650, model: 'private-instance' } })
  })
  await page.goto('/')
  await page.locator('main').press('Control+Alt+p')
  await expect(page.locator('html')).toHaveClass(/private-scope/)
  await page.locator(`a[href="/stories/${story.id}"]`).first().click()
  const tokens = page.getByTestId('story-context-tokens')
  await expect(tokens).toHaveAttribute('aria-label', 'Contexto (tokens): 150 % ocupado · 900 / 600 · Compactada 0 veces')
  await expect(tokens.locator('circle').last()).toHaveAttribute('stroke-dasharray', '100 100')
  await expect(page.getByTestId('story-context-characters')).toHaveAttribute('aria-label', /\/ 20[.]000 · Compactada 0 veces$/)
})

for (const scope of ['normal', 'private'] as const) {
  for (const visualMode of [false, true]) {
    test(`anillos cuentan correctas y consultan historial sin Debug en ${visualMode ? 'Novela' : 'Chat'} ${scope}`, async ({ page, data }) => {
      const story = await data.createStory({ title: 'El faro y la llave azul', characters: [], scope, visualMode })
      const narration = await data.createMessage({ story, scope, role: 'assistant', raw: 'La luz del faro vuelve a encenderse.',
        segments: [{ type: 'narration', text: 'La luz del faro vuelve a encenderse.' }] })
      const base: LlmDebugTrace = {
        id: data.unique('compaction'), storyId: story.id, status: 'success', createdAt: Date.UTC(2026, 9, 5, 12),
        request: { purpose: 'compaction', model: 'test-model', temperature: 0.7, max_tokens: 100, stream: false, messages: [],
          compaction: { before: [{ role: 'assistant', content: 'HISTORIAL_ANTES_DE_COMPACTAR' }],
            after: [{ role: 'assistant', content: 'RESUMEN_DESPUES_DE_COMPACTAR' }], historyBudget: 12000, applied: true,
            beforeUsage: { unit: 'characters', count: 1000, configuredLimit: 12000, effectiveLimit: 12000, model: 'test-model' },
            afterUsage: { unit: 'characters', count: 100, configuredLimit: 12000, effectiveLimit: 12000, model: 'test-model' },
            blocks: [1, 2].map(() => ({ messages: [], summary: 'Resumen de bloque.',
              contextUsage: { unit: 'characters', count: 500, configuredLimit: 12000, effectiveLimit: 12000, model: 'test-model' } })) } },
        response: { content: 'RESUMEN_DESPUES_DE_COMPACTAR', finishReason: 'stop' }
      }
      const traces: LlmDebugTrace[] = [
        base,
        { ...base, id: data.unique('legacy'), createdAt: base.createdAt - 1000,
          request: { ...base.request, compaction: undefined } },
        { ...base, id: data.unique('unapplied'), createdAt: base.createdAt - 2000,
          request: { ...base.request, compaction: { ...base.request.compaction!, applied: false } } },
        { ...base, id: data.unique('failed'), createdAt: base.createdAt - 3000, status: 'error',
          request: { ...base.request, compaction: { ...base.request.compaction!, applied: false, after: undefined } },
          response: { error: 'Compactador no disponible.' } },
        { ...base, id: data.unique('narration'), responseMessageId: narration.id,
          request: { ...base.request, purpose: 'chat', compaction: undefined },
          response: { content: narration.raw, finishReason: 'stop' } }
      ]
      for (const trace of traces) await expect(await page.request.put(`/api/data/llmDebugTraces/${trace.id}?scope=${scope}`, { data: trace })).toBeOK()
      await page.route('**/api/llm/context', route => route.fulfill({ json: { tokens: 500, capacity: 1100, model: 'test-instance' } }))
      if (scope === 'private') {
        await page.goto('/')
        await page.locator('main').press('Control+Alt+p')
        await expect(page.locator('html')).toHaveClass(/private-scope/)
        await page.locator(`a[href="/stories/${story.id}"]`).first().click()
      } else await page.goto(`/stories/${story.id}`)
      const tokens = page.getByTestId('story-context-tokens')
      const chars = page.getByTestId('story-context-characters')
      const history = page.getByRole('dialog', { name: 'Compactaciones de la historia' })
      for (const ring of [tokens, chars]) await expect(ring).toHaveAttribute('aria-label', /Compactada 2 veces$/)
      await expect(page.getByTestId('story-compaction-marker')).toHaveCount(0)
      await page.getByLabel('Tu intervención').fill('BORRADOR_CONSERVADO')
      for (const width of [320, 390, 640, 768, 1280]) {
        await page.setViewportSize({ width, height: 844 })
        for (const ring of [tokens, chars]) {
          await ring.hover()
          const tooltip = await ring.getByRole('tooltip').boundingBox()
          expect(tooltip!.x).toBeGreaterThanOrEqual(0)
          expect(tooltip!.x + tooltip!.width).toBeLessThanOrEqual(width)
        }
        if (scope === 'normal' && width === 390) {
          await page.screenshot({ path: `.data/issue-252-tooltip-${visualMode ? 'novel' : 'chat'}-${width}.png` })
        }
        await tokens.click()
        await expect(history).toBeVisible()
        const items = history.getByRole('listitem')
        await expect(items).toHaveCount(4)
        await expect(items.first()).toHaveAttribute('data-compaction-trace-id', base.id)
        await expect(items.first()).toContainText('1000 caracteres antes · 100 después')
        await expect(items.last()).toContainText('Compactación fallida')
        await expect(history.getByRole('button', { name: 'Borrar compactación' })).toHaveCount(0)
        await expect(history.locator('time')).toHaveCount(4)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
        if (scope === 'normal' && [390, 1280].includes(width)) {
          await page.screenshot({ path: `.data/issue-252-${visualMode ? 'novel' : 'chat'}-${width}.png` })
        }
        await items.first().getByRole('button', { name: 'Ver antes / después' }).click()
        const detail = page.getByRole('dialog', { name: 'Debug compactación' })
        await expect(detail).toContainText('HISTORIAL_ANTES_DE_COMPACTAR')
        await expect(detail).toContainText('RESUMEN_DESPUES_DE_COMPACTAR')
        await expect(detail).toContainText('Compactación en 2 bloques')
        await expect(history).toBeHidden()
        await page.keyboard.press('Escape')
        await expect(detail).toHaveCount(0)
        await expect(history).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(history).toBeHidden()
        await expect(tokens).toBeFocused()
        await chars.press('Enter')
        await expect(history).toBeVisible()
        await history.getByRole('button', { name: 'Cerrar diálogo' }).click()
        await expect(chars).toBeFocused()
      }
      await expect(page.getByLabel('Tu intervención')).toHaveValue('BORRADOR_CONSERVADO')
      await page.reload()
      if (scope === 'private') {
        await page.goto('/')
        await page.locator('main').press('Control+Alt+p')
        await expect(page.locator('html')).toHaveClass(/private-scope/)
        await page.locator(`a[href="/stories/${story.id}"]`).first().click()
      }
      await expect(tokens).toHaveAttribute('aria-label', /Compactada 2 veces$/)
    })
  }
}

test('historial distingue carga pendiente, error y cero compactaciones', async ({ page, data }) => {
  const story = await data.createStory({ characters: [] })
  await page.route('**/api/llm/context', route => route.fulfill({ json: { tokens: 500, capacity: 1100, model: 'test-instance' } }))
  let release: (() => void) | undefined
  const pending = new Promise<void>(resolve => { release = resolve })
  const url = `**/api/data/llmDebugTraces?storyId=${story.id}&scope=normal`
  await page.route(url, async route => {
    await pending
    await route.fulfill({ status: 502, json: { message: 'Fallo de prueba.' } })
  })
  await page.goto(`/stories/${story.id}`)
  const tokens = page.getByTestId('story-context-tokens')
  await expect(tokens).toHaveAttribute('aria-label', /Compactaciones: cargando…$/)
  await tokens.click()
  const history = page.getByRole('dialog', { name: 'Compactaciones de la historia' })
  await expect(history.getByRole('status')).toHaveText('Cargando compactaciones…')
  release!()
  await expect(history.getByRole('alert')).toContainText('No se pudieron cargar las compactaciones')
  await expect(tokens).toHaveAttribute('aria-label', /Compactaciones: no disponibles$/)
  await expect(history).not.toContainText('No hay compactaciones conservadas')
  await page.unroute(url)
  await page.reload()
  await expect(tokens).toHaveAttribute('aria-label', /Compactada 0 veces$/)
  await tokens.click()
  await expect(history).toContainText('No hay compactaciones conservadas')
})
