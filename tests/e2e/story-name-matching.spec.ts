import { resolve } from 'node:path'
import type { Message } from '../../shared/types'
import { expect, test } from './fixtures'

for (const visualMode of [false, true]) {
  test(`reconoce nombres sin acentos y conserva identidad e historial; visualMode=${visualMode}`, async ({ page, data, request }) => {
    await expect(await request.post('/api/data/clear?scope=normal')).toBeOK()
    await data.patchSettings({
      mockMode: false, useChromeLlm: false, privateUseChromeLlm: null, model: 'test',
      userName: 'Álex', userColor: '#60a5fa', responseSpeed: 'instant', visualNovelManualAdvance: false
    })
    const character = await data.createCharacter({ name: 'Nombre del catálogo', color: '#16a34a' })
    const image = await data.createImage(character, ['feliz'])
    const story = await data.createStory({ characters: [character], visualMode, title: 'Nombres con acentos' })
    await expect(await request.put(`/api/data/stories/${story.id}?scope=normal`, {
      data: { ...story, characterCustomizations: [{ ...story.characterCustomizations![0], name: 'Júlia' }] }
    })).toBeOK()
    const raw = 'Julia [feliz]: Hola, Álex.\nPensamiento JULIA [feliz]: Me alegra verte.\nAlex: Te sigo.\nPensamiento Alex: Confío en ti.'
    await page.route('**/api/llm/chat', route => route.fulfill({ json: { content: raw, finishReason: 'stop' } }))
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/stories/${story.id}`)
    await page.getByTestId('auto-button').click()
    await expect.poll(async () => (await data.list<Message>('messages', 'normal', { storyId: story.id }))
      .find(message => message.role === 'assistant')?.segments.map(segment => segment.type))
      .toEqual(['dialogue', 'thought', 'protagonist-dialogue', 'protagonist-thought'])
    const stored = (await data.list<Message>('messages', 'normal', { storyId: story.id }))
      .find(message => message.role === 'assistant')!
    expect(stored.raw).toBe(raw)
    expect(stored.segments[1]).toMatchObject({ characterId: character.id, imageId: image.id })
    await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible()
    if (!visualMode) await page.getByTestId('visual-mode-toggle').click()
    else {
      await expect(page.getByTestId('visual-novel-frame')).toHaveText('Júlia: Hola, Álex.')
      for (let index = 0; index < 3; index++) await page.getByTestId('visual-novel-next').click()
    }
    await expect(page.getByTestId('visual-novel-frame')).toHaveText('Álex: (Confío en ti.)')
    await page.getByTestId('visual-novel-previous').click()
    await page.getByTestId('visual-novel-previous').click()
    await expect(page.getByTestId('visual-novel-frame')).toHaveText('Júlia: (Me alegra verte.)')
    await expect(page.getByTestId('story-thought').filter({ visible: true })).toHaveCSS('color', 'rgb(22, 163, 74)')
    await expect(page.locator(`[data-character-id="${character.id}"] img`).first()).toHaveAttribute('src', new RegExp(image.id))
    await page.screenshot({ path: resolve(`.data/issue-247-novela-${visualMode}.png`) })
    await page.getByTestId('visual-mode-toggle').click()
    await expect(page.getByTestId('story-scroller').getByText('(Me alegra verte.)', { exact: true }).locator('..')).toContainText('Júlia:')
    await expect(page.getByTestId('story-scroller').getByText('(Me alegra verte.)', { exact: true })).toBeVisible()
    await page.screenshot({ path: resolve(`.data/issue-247-chat-${visualMode}.png`) })
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 800 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.getByTestId('visual-mode-toggle').click()
      await expect(page.getByRole('button', { name: 'Activar modo novela visual', exact: true })).toHaveAttribute('aria-pressed', 'true')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.getByTestId('visual-mode-toggle').click()
      await expect(page.getByRole('button', { name: 'Desactivar modo novela visual', exact: true })).toHaveAttribute('aria-pressed', 'true')
    }
    await page.reload()
    await expect(page.getByTestId('story-scroller').getByText('(Me alegra verte.)', { exact: true })).toBeVisible()
    expect((await data.list<Message>('messages', 'normal', { storyId: story.id }))[0]?.segments).toEqual(stored.segments)
  })
}
