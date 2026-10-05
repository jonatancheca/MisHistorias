import { expect, test } from './fixtures'

for (const width of [320, 390, 639, 640, 768, 1024, 1280]) {
  test(`controles de lectura y herramientas accesibles en ambos modos a ${width}px`, async ({ page, data }) => {
    await data.patchSettings({ mockMode: true, responseSpeed: 'instant', visualNovelManualAdvance: false })
    const story = await data.createStory({ characters: [], title: 'La última luz del faro', premise: 'Una señal en el horizonte cambia el rumbo de la noche.' })
    for (let i = 0; i < 12; i++) {
      const text = `Escena ${i + 1}. El viento trae una señal desde el otro lado de la bahía. La luz del faro vuelve a encenderse.`
      await data.createMessage({ story, role: 'assistant', raw: text, segments: [{ type: 'narration', text }] })
    }
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`/stories/${story.id}`)
    const tools = page.getByTestId('story-tools-toggle')
    const panel = page.getByTestId('story-tools-panel')

    for (const visual of [false, true]) {
      if (visual) await page.getByTestId('visual-mode-toggle').click()
      await expect(page.getByRole('heading', { name: story.title })).toBeVisible()
      await expect(tools).toHaveAttribute('aria-expanded', 'false')
      await expect(panel).toBeHidden()
      await tools.press('Enter')
      await expect(panel).toBeVisible()
      await tools.press('Tab')
      await expect(page.getByRole('button', { name: 'Partidas', exact: true })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(panel).toBeHidden()
      await expect(tools).toBeFocused()
      await tools.click()
      await page.getByRole('heading', { name: story.title }).click()
      await expect(panel).toBeHidden()
      await tools.click()
      await page.getByRole('button', { name: 'Ajustes de la historia', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Ajustes de la historia' })).toBeVisible()
      await expect(panel).toBeHidden()
      await page.keyboard.press('Escape')
      await tools.click()
      await page.getByTestId('story-debug-toggle').click()
      await expect(page.getByTestId('story-debug-toggle')).toHaveAttribute('aria-pressed', 'true')
      await expect(panel).toBeHidden()
      await tools.click()
      await page.getByTestId('story-debug-toggle').click()

      await page.getByTestId('story-start-button').click()
      if (visual) {
        await expect(page.getByTestId('visual-novel-counter')).toHaveText('1 / 12')
        await page.getByTestId('visual-novel-next').click()
        await expect(page.getByTestId('visual-novel-counter')).toHaveText('2 / 12')
        await page.getByTestId('visual-novel-previous').click()
        await expect(page.getByTestId('visual-novel-counter')).toHaveText('1 / 12')
      } else {
        await expect.poll(() => page.getByTestId('story-scroller').evaluate(el => el.scrollTop)).toBeLessThan(2)
      }
      await page.getByTestId('story-end-button').click()
      if (visual) await expect(page.getByTestId('visual-novel-counter')).toHaveText('12 / 12')
      await page.getByLabel('Tu intervención').fill('Observo el horizonte.')
      await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled()
      const writeBounds = await page.locator('.story-write-box').boundingBox()
      const sendBounds = await page.getByRole('button', { name: 'Enviar', exact: true }).boundingBox()
      expect(Math.abs((writeBounds!.y + writeBounds!.height / 2) - (sendBounds!.y + sendBounds!.height / 2))).toBeLessThan(1)
      if (width === 1280) {
        await expect(page.getByTestId('story-start-button')).toHaveAttribute('title', /Ctrl\+Inicio/)
        await expect(page.getByTestId('story-end-button')).toHaveAttribute('title', /Ctrl\+Fin/)
        await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toHaveAttribute('title', /Enter \/ Ctrl\+Enter/)
        if (visual) {
          await expect(page.getByTestId('visual-novel-previous')).toHaveAttribute('title', /Re Pág/)
          await expect(page.getByTestId('visual-novel-next')).toHaveAttribute('title', /Av Pág \/ Espacio \/ Enter/)
        }
      }
      const position = await page.evaluate(() => {
        const counter = document.querySelector('.story-frame-position')!.getBoundingClientRect()
        const next = (document.querySelector('[data-testid="visual-novel-next"]') ?? document.querySelector('[data-testid="story-end-button"]'))!.getBoundingClientRect()
        return { counterRight: counter.right, nextLeft: next.left,
          counterCenterY: counter.top + counter.height / 2, nextCenterY: next.top + next.height / 2 }
      })
      expect(position.nextLeft - position.counterRight).toBeGreaterThanOrEqual(0)
      expect(position.nextLeft - position.counterRight).toBeLessThanOrEqual(12)
      expect(Math.abs(position.counterCenterY - position.nextCenterY)).toBeLessThan(1)
      if (width >= 1280) {
        const row = await page.evaluate(() => {
          const buttons = [...document.querySelectorAll('.story-reader-controls button')]
            .filter(button => button.getClientRects().length > 0)
            .map(button => button.getBoundingClientRect().top)
          return Math.max(...buttons) - Math.min(...buttons)
        })
        expect(row).toBeLessThan(1)
      }
      if (width >= 640) {
        const adjacent = await page.evaluate(() => {
          const options = document.querySelector('#story-reader-options')!
          const mode = options.querySelector('.story-mode-switch')!.getBoundingClientRect()
          const rings = options.querySelector('.story-context-indicators')?.getBoundingClientRect()
          const tools = options.querySelector('[data-testid="story-tools-toggle"]')!.getBoundingClientRect()
          return { modeRight: mode.right, toolsLeft: tools.left,
            toolsRight: tools.right, ringsLeft: rings?.left ?? tools.right }
        })
        expect(adjacent.toolsLeft - adjacent.modeRight).toBeGreaterThanOrEqual(0)
        expect(adjacent.toolsLeft - adjacent.modeRight).toBeLessThanOrEqual(12)
        expect(adjacent.ringsLeft - adjacent.toolsRight).toBeGreaterThanOrEqual(0)
        expect(adjacent.ringsLeft - adjacent.toolsRight).toBeLessThanOrEqual(12)
      }
      await expect(page.getByTestId('story-reader-controls')).not.toContainText('Cuadros')
      const geometry = await page.evaluate(() => {
        const controls = [...document.querySelectorAll('#story-header button, .story-reader-controls button, .story-composer button')]
          .filter(el => el.getClientRects().length > 0)
          .map(el => { const r = el.getBoundingClientRect(); return { text: el.textContent, x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height } })
        return { viewport: innerWidth, document: document.documentElement.scrollWidth, controls,
          overlaps: controls.flatMap((a, i) => controls.slice(i + 1).filter(b => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y)) }
      })
      expect(geometry.document).toBe(geometry.viewport)
      expect(geometry.overlaps).toEqual([])
      for (const control of geometry.controls) {
        expect(control.width, control.text ?? '').toBeGreaterThanOrEqual(44)
        expect(control.height, control.text ?? '').toBeGreaterThanOrEqual(44)
        expect(control.x).toBeGreaterThanOrEqual(0)
        expect(control.right).toBeLessThanOrEqual(width)
        expect(control.bottom).toBeLessThanOrEqual(844)
      }
      await page.screenshot({ path: `.data/story-reader-buttons-${visual ? 'novel' : 'chat'}-${width}.png` })
      await page.getByLabel('Tu intervención').fill('')
    }
  })
}
