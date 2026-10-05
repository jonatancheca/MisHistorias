import type { Story } from '../../shared/types'
import { test, expect } from './fixtures'

test.beforeEach(async ({ page, data }) => {
  await data.patchSettings({ mockMode: false, model: 'test-model', useChromeLlm: false,
    privateUseChromeLlm: null, privateLlmSettingsEnabled: false,
    contextTokenBudget: 3000, historyBudget: 12000, maxTokens: 100,
    narrativePrompt: 'Narra la historia.', responseSpeed: 'instant' })
  await page.route('**/api/llm/model-status?*', route => route.fulfill({ json: { loaded: true } }))
})

test('mide sin bloquear, excluye borrador y muestra limites efectivos en ambos modos y tablets', async ({ page, data }) => {
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
  await expect(page.getByTestId('story-context-tokens')).toHaveCount(0)
  release!()
  const tokens = page.getByTestId('story-context-tokens')
  const chars = page.getByTestId('story-context-characters')
  await expect(tokens).toHaveAttribute('aria-label', 'Contexto (tokens): 50 % ocupado · 500 / 1000')
  await expect(chars).toHaveAttribute('aria-label', new RegExp(`${characters.toLocaleString('es-ES')} / 12[.]000`))
  await tokens.press('Tab')
  await chars.press('Shift+Tab')
  await expect(tokens).toBeFocused()
  await expect(tokens.getByRole('tooltip')).toBeVisible()
  await expect(tokens.getByRole('tooltip')).toHaveText('Contexto (tokens): 50 % ocupado · 500 / 1000')
  await page.getByLabel('Tu intervención').fill('Otro borrador.')
  expect(calls).toBe(1)

  for (const visual of [false, true]) {
    if (visual) await page.getByTestId('visual-mode-toggle').click()
    for (const width of [320, 390, 639, 640, 768, 1024, 1280]) {
      await page.setViewportSize({ width, height: width === 1024 ? 768 : 844 })
      if (width < 640) {
        await expect(tokens).toHaveCount(0)
        await expect(chars).toHaveCount(0)
      } else {
        await expect(tokens).toBeVisible()
        await expect(chars).toBeVisible()
        const geometry = await page.evaluate(() => {
          const options = document.querySelector('#story-reader-options')!
          const tools = options.querySelector('[data-testid="story-tools-toggle"]')!.getBoundingClientRect()
          const rings = [...options.querySelectorAll('.story-context-indicator')].map(el => {
            const r = el.getBoundingClientRect()
            return { width: r.width, height: r.height, left: r.left, right: r.right }
          })
          return { toolsRight: tools.right, viewport: innerWidth, rings }
        })
        for (const ring of geometry.rings) {
          expect(ring.width).toBe(16)
          expect(ring.height).toBe(16)
          expect(ring.left).toBeGreaterThanOrEqual(geometry.toolsRight)
          expect(ring.right).toBeLessThanOrEqual(geometry.viewport)
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    }
  }
  await page.screenshot({ path: '.data/issue-240-novel.png' })
})

test('limites desactivados no consultan tokens; fallo oculta solo anillo de tokens', async ({ page, data }) => {
  const story = await data.createStory({ characters: [] })
  let calls = 0
  await page.route('**/api/llm/context', route => {
    calls += 1
    return route.fulfill({ status: 502, json: { message: 'Tokenizador no disponible.' } })
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
  await expect(page.getByTestId('story-context-tokens')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await data.patchSettings({ contextTokenBudget: 0, historyBudget: 0 })
  const before = calls
  await page.reload()
  await expect(page.getByRole('heading', { name: story.title })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Ocupación del contexto' })).toHaveCount(0)
  expect(calls).toBe(before)
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

test('tablet horizontal tactil muestra ambos anillos sin requerir raton', async ({ browser, data }) => {
  const story = await data.createStory({ characters: [], visualMode: true })
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true })
  const tablet = await context.newPage()
  try {
    await tablet.route('**/api/llm/model-status?*', route => route.fulfill({ json: { loaded: true } }))
    await tablet.route('**/api/llm/context', route => route.fulfill({ json: { tokens: 750, capacity: 30000, model: 'test-instance' } }))
    await tablet.goto(`/stories/${story.id}`)
    expect(await tablet.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
    await expect(tablet.getByTestId('story-context-tokens')).toBeVisible()
    await expect(tablet.getByTestId('story-context-characters')).toBeVisible()
    await tablet.getByTestId('story-context-tokens').click()
    await expect(tablet.getByTestId('story-context-tokens').getByRole('tooltip')).toBeVisible()
    expect(await tablet.evaluate(() => document.documentElement.scrollWidth)).toBe(1024)
    await tablet.screenshot({ path: '.data/issue-240-tablet.png' })
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
  const label = 'Contexto (tokens): 20 % ocupado · 200 / 1000'
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
  await expect(tokens).toHaveAttribute('aria-label', 'Contexto (tokens): 150 % ocupado · 900 / 600')
  await expect(tokens.locator('circle').last()).toHaveAttribute('stroke-dasharray', '100 100')
  await expect(page.getByTestId('story-context-characters')).toHaveAttribute('aria-label', /\/ 20[.]000$/)
})
