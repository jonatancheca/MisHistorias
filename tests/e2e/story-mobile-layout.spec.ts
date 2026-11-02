import type { Message } from '../../shared/types'
import { expect, test } from './fixtures'

for (const scope of ['normal', 'private'] as const) {
  for (const width of [320, 390]) {
    test(`acciones móviles conservan función y borrador; ${scope}, ${width}px`, async ({ page, data }) => {
      await data.patchSettings({
        mockMode: false, useChromeLlm: false, model: 'modelo-prueba', maxTokens: 100,
        responseSpeed: 'instant', historyBudget: 12000, contextTokenBudget: 3000,
        privateLlmSettingsEnabled: true, privateUseChromeLlm: false,
        privateModel: 'modelo-privado', privateMaxTokens: 100,
        privateHistoryBudget: 12000, privateContextTokenBudget: 3000,
        visualNovelManualAdvance: false
      })
      const story = await data.createStory({ title: 'QA · El faro azul', characters: [], scope })
      await data.createMessage({ story, scope, role: 'assistant', raw: 'La luz ilumina el puerto.',
        segments: [{ type: 'narration', text: 'La luz ilumina el puerto.' }] })
      let loaded = false
      let failLoad = true
      let chats = 0
      await page.route('**/api/llm/model-status?*', route => route.fulfill({ json: { loaded } }))
      await page.route('**/api/llm/context', route => route.fulfill({
        json: { tokens: 500, capacity: 4096, model: 'modelo-prueba' }
      }))
      await page.route('**/api/llm/model-management', route => {
        expect(route.request().postDataJSON()).toEqual({ action: 'load', scope })
        if (failLoad) {
          failLoad = false
          return route.fulfill({ status: 502, json: { message: 'Carga de prueba fallida.' } })
        }
        loaded = true
        return route.fulfill({ json: { status: 'loaded', instanceId: 'modelo-prueba' } })
      })
      await page.route('**/api/llm/chat', route => {
        const payload = route.request().postDataJSON()
        expect(payload.scope).toBe(scope)
        expect(JSON.stringify(payload.messages)).toContain(chats === 0
          ? 'No inventes acciones, decisiones, diálogo ni pensamientos'
          : 'Puedes inventar acciones, decisiones, diálogo y pensamientos')
        expect(JSON.stringify(payload.messages)).not.toContain('Borrador sin enviar.')
        chats += 1
        return route.fulfill({ json: { content: 'El horizonte se despeja.', finishReason: 'stop' } })
      })
      await page.setViewportSize({ width, height: 844 })
      if (scope === 'private') {
        await page.goto('/')
        await page.locator('main').press('Control+Alt+p')
        await expect(page.locator('html')).toHaveClass(/private-scope/)
        await page.locator(`a[href="/stories/${story.id}"]`).first().click()
      } else await page.goto(`/stories/${story.id}`)
      const tools = page.getByTestId('story-tools-toggle')
      const panel = page.getByTestId('story-tools-panel')
      const input = page.getByLabel('Tu intervención')
      const messages = () => data.list<Message>('messages', scope, { storyId: story.id })
      await input.fill('Borrador sin enviar.')
      const menu = page.getByTestId('mobile-story-menu-toggle')
      if (await menu.getAttribute('aria-expanded') === 'true') await menu.click()
      for (const visual of [false, true]) {
        if (visual) await page.getByTestId('visual-mode-toggle').click()
        await expect(page.getByTestId('mobile-story-menu-toggle')).toHaveAttribute('aria-expanded', 'false')
        await expect(page.getByRole('button', { name: 'Enviar', exact: true }).locator('span')).toBeHidden()
        await expect(page.getByTestId('continue-button')).toBeHidden()
        await expect(page.getByTestId('auto-button')).toBeHidden()
        await expect(page.locator('.story-frame-navigation-start').getByTestId('story-context-tokens')).toBeVisible()
        const tokens = page.getByTestId('story-context-tokens')
        await tokens.focus()
        const tooltip = tokens.getByRole('tooltip')
        await expect(tooltip).toBeVisible()
        const bounds = await tooltip.boundingBox()
        expect(bounds!.x).toBeGreaterThanOrEqual(0)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
        await tokens.click()
        await expect(page.getByRole('dialog', { name: 'Compactaciones de la historia' })).toBeVisible()
        await page.keyboard.press('Escape')
        const beforeLoad = await messages()
        loaded = false
        await page.evaluate(() => window.dispatchEvent(new Event('focus')))
        await tools.click()
        const load = panel.getByTestId('story-model-load')
        await expect(page.getByTestId('story-model-load')).toHaveCount(1)
        await load.click()
        await expect(panel).toBeHidden()
        if (!visual) {
          await expect(page.getByTestId('story-model-load-error')).toHaveText('Carga de prueba fallida.')
          await tools.click()
          await load.click()
        }
        await expect(page.getByTestId('story-model-load')).toHaveCount(0)
        await expect(input).toHaveValue('Borrador sin enviar.')
        expect(await messages()).toEqual(beforeLoad)
        expect(chats).toBe(visual ? 1 : 0)
        await tools.click()
        await panel.getByTestId(visual ? 'auto-button' : 'continue-button').click()
        await expect(panel).toBeHidden()
        await expect.poll(messages).toHaveLength(beforeLoad.length + 1)
        await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible()
        await expect(input).toHaveValue('Borrador sin enviar.')
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
        await page.screenshot({ path: `.data/issue-273-${scope}-${visual ? 'novel' : 'chat'}-${width}.png` })
      }
      expect(chats).toBe(2)
      expect((await messages()).filter(message => message.role === 'user')).toEqual([])
    })
  }
}
