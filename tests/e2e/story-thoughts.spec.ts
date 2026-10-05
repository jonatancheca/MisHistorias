import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Message, Story } from '../../shared/types'
import { expect, test } from './fixtures'

test.beforeEach(async ({ data, request }) => {
  await expect(await request.post('/api/data/clear?scope=normal')).toBeOK()
  await data.patchSettings({
    mockMode: false, useChromeLlm: false, privateUseChromeLlm: null, model: 'test',
    userName: 'Vera', userColor: '#60a5fa', responseSpeed: 'instant', visualNovelManualAdvance: false
  })
})

test('genera pensamientos y conserva formato, color e imágenes en ambas vistas y en el historial', async ({ page, data }) => {
  const character = await data.createCharacter({ name: 'Alicia', color: '#e11d48' })
  await data.createImage(character, ['neutral'])
  const image = await data.createImage(character, ['feliz', 'sonrisa'])
  const preset = await data.createPreset({ content: 'Narra una escena breve con mi preset personalizado.' })
  const story = await data.createStory({ characters: [character], preset, title: 'Pensamientos en el pasillo' })
  await expect(await page.request.put(`/api/data/stories/${story.id}?scope=normal`, {
    data: { ...story, characterCustomizations: [{ ...story.characterCustomizations![0], name: 'Lia', color: '#16a34a' }] }
  })).toBeOK()
  const raw = '(Una pausa.)\nLia [neutral]: (Todo va bien.)\nPensamiento Lia [feliz][sonrisa]: No debo decirlo. [secreto]'
  const requests: Array<Array<{ role: string; content: string }>> = []
  await page.route('**/api/llm/chat', async route => {
    requests.push(route.request().postDataJSON().messages)
    await route.fulfill({ json: { content: raw, finishReason: 'stop' } })
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/stories/${story.id}`)
  const composer = page.getByRole('textbox', { name: 'Tu intervención', exact: true })
  await composer.fill('Entro en el pasillo.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect.poll(async () => (await data.list<Message>('messages', 'normal', { storyId: story.id }))
    .find(message => message.role === 'assistant')?.segments.map(segment => segment.type))
    .toEqual(['narration', 'dialogue', 'thought'])
  const stored = (await data.list<Message>('messages', 'normal', { storyId: story.id })).find(message => message.role === 'assistant')!
  expect(stored.raw).toBe(raw)
  expect(stored.segments[2]).toMatchObject({ characterId: character.id, tags: ['feliz', 'sonrisa'], imageId: image.id })
  expect(requests[0]![0]!.content).toContain('Pensamiento Nombre [etiqueta][otra etiqueta]: texto')
  expect(requests[0]![0]!.content).toContain('No inventes sus pensamientos')
  await page.reload()
  const thought = page.getByTestId('story-thought').filter({ visible: true })
  await expect(thought).toHaveText('(No debo decirlo.)')
  await expect(thought).toHaveCSS('font-style', 'italic')
  await expect(thought).toHaveCSS('color', 'rgb(22, 163, 74)')
  await expect(thought.locator('..')).toContainText('Lia:')
  await page.screenshot({ path: resolve('.data/issue-242-chat.png') })
  await page.getByTestId('visual-mode-toggle').click()
  await expect(page.getByTestId('visual-novel-frame')).toHaveText('Lia: (No debo decirlo.)')
  await expect(thought).toHaveCSS('font-style', 'italic')
  await expect(thought).toHaveCSS('color', 'rgb(22, 163, 74)')
  await expect(page.locator(`[data-character-id="${character.id}"] img`).first()).toHaveAttribute('src', new RegExp(image.id))
  await page.screenshot({ path: resolve('.data/issue-242-novela.png') })
  await page.getByTestId('visual-novel-previous').click()
  await expect(page.getByTestId('visual-novel-frame')).toHaveText('Lia: (Todo va bien.)')
  await expect(thought).toHaveCount(0)
  await page.getByTestId('visual-novel-next').click()
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 800 })
    await expect(thought).toHaveText('(No debo decirlo.)')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByTestId('visual-mode-toggle').click()
    await expect(thought).toHaveCSS('font-style', 'italic')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByTestId('visual-mode-toggle').click()
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await composer.fill('Continúa la escena.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect.poll(() => requests.length).toBe(2)
  expect(requests[1]!.find(message => message.role === 'assistant')?.content)
    .toContain('Pensamiento Lia [feliz][sonrisa]: No debo decirlo. [secreto]')
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible()
})

test('Auto devuelve un pensamiento del protagonista con su nombre y color, conservado al recargar', async ({ page, data }) => {
  const story = await data.createStory({ characters: [], visualMode: true })
  let system = ''
  await page.route('**/api/llm/chat', async route => {
    system = route.request().postDataJSON().messages[0].content
    await route.fulfill({ json: { content: 'Pensamiento Vera: Debo tener cuidado.', finishReason: 'stop' } })
  })
  await page.goto(`/stories/${story.id}`)
  await page.getByTestId('auto-button').click()
  const thought = page.getByTestId('story-thought').filter({ visible: true })
  await expect(thought).toHaveText('(Debo tener cuidado.)')
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible()
  expect(system).toContain('Pensamiento Vera: texto')
  expect(system).not.toContain('No inventes sus pensamientos')
  await expect.poll(async () => (await data.list<Message>('messages', 'normal', { storyId: story.id }))[0]?.segments[0]?.type)
    .toBe('protagonist-thought')
  await expect(thought).toHaveCSS('font-style', 'italic')
  await expect(thought).toHaveCSS('color', 'rgb(96, 165, 250)')
  await expect(page.getByTestId('visual-novel-frame')).toHaveText('Vera: (Debo tener cuidado.)')
  await page.reload()
  await expect(thought).toHaveText('(Debo tener cuidado.)')
  await page.getByTestId('visual-mode-toggle').click()
  await expect(thought).toHaveText('(Debo tener cuidado.)')
  await expect(thought).toHaveCSS('color', 'rgb(96, 165, 250)')
})

test('exportar e importar conserva pensamientos, etiquetas y referencias remapeadas', async ({ page, data }) => {
  const character = await data.createCharacter({ name: 'Alicia' })
  const image = await data.createImage(character, ['feliz', 'capa'])
  const story = await data.createStory({ characters: [character] })
  await data.createMessage({ story, role: 'assistant', raw: 'Pensamiento Alicia [feliz][capa]: Mi secreto.', segments: [
    { type: 'thought', characterId: character.id, tag: 'feliz', tags: ['feliz', 'capa'], imageId: image.id, text: 'Mi secreto.' },
    { type: 'protagonist-thought', characterId: null, tag: null, text: 'Espero.' }
  ] })
  await page.goto('/settings')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar JSON' }).click()
  const bundle = readFileSync((await (await downloaded).path())!, 'utf8')
  await page.locator('input[accept="application/json"]').setInputFiles({
    name: 'pensamientos.json', mimeType: 'application/json', buffer: Buffer.from(bundle)
  })
  await expect(page.getByText('Importación completada')).toBeVisible()
  const imported = (await data.list<Story>('stories')).find(entry => entry.id !== story.id && entry.title === story.title)!
  const messages = await data.list<Message>('messages', 'normal', { storyId: imported.id })
  const thought = messages[0]!.segments[0]!
  expect(thought).toMatchObject({ type: 'thought', tags: ['feliz', 'capa'], text: 'Mi secreto.' })
  expect(thought.characterId).toBe(imported.characterIds[0])
  expect(thought.characterId).not.toBe(character.id)
  expect(thought.imageId).not.toBe(image.id)
  expect(messages[0]!.segments[1]!.type).toBe('protagonist-thought')
  await page.goto(`/stories/${imported.id}`)
  await expect(page.getByTestId('story-thought').first()).toHaveText('(Mi secreto.)')
  await expect(page.getByTestId('story-thought').first()).toHaveCSS('font-style', 'italic')
})
