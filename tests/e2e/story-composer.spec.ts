import type { Message } from '../../shared/types'
import { expect, test } from './fixtures'

for (const visualMode of [false, true]) {
  const mode = visualMode ? 'Novela Visual' : 'Chat'

  test.describe(mode, () => {
    test.describe('móvil', () => {
      test.use({ isMobile: true, hasTouch: true })

      for (const width of [320, 390]) {
        test(`Enter permite escribir varias líneas a ${width}px`, async ({ page, data }) => {
          await data.patchSettings({ mockMode: true, responseSpeed: 'instant', useChromeLlm: false })
          const story = await data.createStory({ characters: [], visualMode })
          const userMessages = async () => (await data.list<Message>('messages', 'normal', { storyId: story.id }))
            .filter(message => message.role === 'user').map(message => message.raw)
          await page.setViewportSize({ width, height: 844 })
          await page.goto(`/stories/${story.id}`)
          const input = page.getByLabel('Tu intervención')
          const send = page.getByRole('button', { name: 'Enviar', exact: true })
          await expect(send).toHaveAttribute('aria-keyshortcuts', 'Control+Enter')
          await input.fill('Primera línea')
          await input.press('Enter')
          await expect(input).toHaveValue('Primera línea\n')
          await input.pressSequentially('Segunda línea')
          const multiline = 'Primera línea\nSegunda línea'
          await expect(input).toHaveValue(multiline)
          expect(await userMessages()).toEqual([])
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
          await page.screenshot({ path: test.info().outputPath(`composer-${width}.png`) })
          await send.click()
          await expect.poll(userMessages).toEqual([multiline])
          await expect(input).toHaveValue('')
          await expect(send).toBeVisible()
          await input.fill('Envío explícito con atajo')
          await input.press('Control+Enter')
          await expect.poll(userMessages).toEqual([multiline, 'Envío explícito con atajo'])
        })
      }
    })

    test('escritorio conserva Enter, Mayús+Enter y Ctrl+Enter', async ({ page, data }) => {
      await data.patchSettings({ mockMode: true, responseSpeed: 'instant', useChromeLlm: false })
      const story = await data.createStory({ characters: [], visualMode })
      const userMessages = async () => (await data.list<Message>('messages', 'normal', { storyId: story.id }))
        .filter(message => message.role === 'user').map(message => message.raw)
      await page.setViewportSize({ width: 1280, height: 844 })
      await page.goto(`/stories/${story.id}`)
      const input = page.getByLabel('Tu intervención')
      const send = page.getByRole('button', { name: 'Enviar', exact: true })
      await expect(send).toHaveAttribute('aria-keyshortcuts', 'Enter Control+Enter')
      await input.fill('Primera línea')
      await input.press('Shift+Enter')
      await expect(input).toHaveValue('Primera línea\n')
      await input.pressSequentially('Segunda línea')
      const multiline = 'Primera línea\nSegunda línea'
      expect(await userMessages()).toEqual([])
      await input.press('Enter')
      await expect.poll(userMessages).toEqual([multiline])
      await expect(input).toHaveValue('')
      await expect(send).toBeVisible()
      await input.fill('Envío con Ctrl+Enter')
      await input.press('Control+Enter')
      await expect.poll(userMessages).toEqual([multiline, 'Envío con Ctrl+Enter'])
    })
  })
}
