import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Message, Story, StorySaveSlot } from '../../shared/types'
import { expect, test } from './fixtures'

test.beforeEach(async ({ request, data }) => {
  await expect(await request.post('/api/data/clear?scope=normal')).toBeOK()
  await data.patchSettings({ mockMode: false, useChromeLlm: false, privateUseChromeLlm: null, model: 'test',
    userName: 'Vera', responseSpeed: 'instant', visualNovelManualAdvance: false,
    historyBudget: 0, contextTokenBudget: 0, maxTokens: 100, swarmBaseUrl: '' })
})

test('crea historia con ausentes y permite reincorporarlos desde Más opciones en móvil', async ({ page, data }) => {
  const character = await data.createCharacter({ name: 'Alicia' })
  await data.createImage(character)
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/stories/new')
  await page.getByLabel('Planteamiento', { exact: true }).fill('Esperamos a Alicia.')
  await page.getByRole('button', { name: 'Añadir personaje', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Añadir Alicia al elenco', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Presente al comenzar: Alicia' }).uncheck()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Empezar historia', exact: true }).click()
  await expect(page.getByTestId('visual-novel-view')).toBeVisible()
  const story = (await data.list<Story>('stories')).find((entry) => entry.premise === 'Esperamos a Alicia.')!
  expect(story.absentCharacterIds).toEqual([character.id])
  await expect(page.getByTestId('visual-novel-cast').locator('figure')).toHaveCount(0)
  await page.getByTestId('story-tools-toggle').click()
  await page.getByTestId('story-presence-button').click()
  await expect(page.getByRole('dialog')).toContainText('Siempre presente')
  const toggle = page.getByRole('switch', { name: 'Presencia de Alicia' })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect.poll(async () => (await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([])
  await page.getByRole('button', { name: 'Cerrar personajes' }).click()
  await expect(page.getByTestId('visual-novel-cast').locator('figure')).toHaveCount(1)
})

for (const width of [320, 390, 1280]) {
  for (const lastRole of ['user', 'assistant'] as const) {
    test(`cambiar presencia conserva texto ${lastRole}, navegación y aspecto a ${width} px`, async ({ page, data }) => {
      const character = await data.createCharacter({ name: 'Bruno' })
      await data.createImage(character, ['neutral'])
      const story = await data.createStory({ characters: [character], visualMode: true })
      const earlier = await data.createMessage({ story, role: 'assistant', raw: 'Bruno [neutral]: Hola.\nLa escena continúa.', segments: [
        { type: 'dialogue', characterId: character.id, tag: 'neutral', text: 'Hola.' },
        { type: 'narration', characterId: null, tag: null, text: 'La escena continúa.' }
      ] })
      const lastText = lastRole === 'user' ? 'Me quedo esperando.' : 'Esperamos junto a la puerta.'
      const latest = await data.createMessage({ story, role: lastRole, raw: lastText, segments: lastRole === 'assistant'
        ? [{ type: 'narration', characterId: null, tag: null, text: lastText }]
        : [] })
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/stories/' + story.id)
      const frame = page.getByTestId('visual-novel-frame')
      const counter = page.getByTestId('visual-novel-counter')
      const sprite = page.getByTestId('visual-novel-cast').locator('[data-character-id="' + character.id + '"]')
      await expect(frame).toContainText(lastText)
      await expect(counter).toHaveText('3 / 3')
      await expect(sprite.locator('img')).toBeVisible()
      const imageUrl = await sprite.locator('img').getAttribute('src')
      const changePresence = async () => {
        await page.getByTestId('story-tools-toggle').click()
        await page.getByTestId('story-presence-button').click()
        const toggle = page.getByRole('switch', { name: 'Presencia de Bruno' })
        const wasPresent = await toggle.getAttribute('aria-checked') === 'true'
        await toggle.click()
        await expect(toggle).toHaveAttribute('aria-checked', String(!wasPresent))
        await page.getByRole('button', { name: 'Cerrar personajes' }).click()
      }
      await changePresence()
      await expect(frame).toContainText(lastText)
      await expect(counter).toHaveText('3 / 3')
      await expect(sprite).toHaveCount(0)
      await page.getByTestId('story-tools-toggle').click()
      await page.getByTestId('story-debug-toggle').click()
      await expect(frame).toContainText(lastText)
      await expect(counter).toHaveText('3 / 3')
      await expect(page.getByText('Presencia en escena para la próxima respuesta.', { exact: true })).toHaveCount(0)
      await changePresence()
      await expect(sprite.locator('img')).toHaveAttribute('src', imageUrl!)
      await expect(frame).toContainText(lastText)
      await expect(counter).toHaveText('3 / 3')
      await page.reload()
      await expect(frame).toContainText(lastText)
      await expect(counter).toHaveText('3 / 3')
      await page.getByTestId('visual-novel-previous').click()
      await expect(frame).toContainText('La escena continúa.')
      await changePresence()
      await expect(frame).toContainText('La escena continúa.')
      await expect(counter).toHaveText('2 / 3')
      await expect(sprite.locator('img')).toHaveAttribute('src', imageUrl!)
      await page.getByTestId('story-end-button').click()
      await expect(frame).toContainText(lastText)
      await expect(counter).toHaveText('3 / 3')
      await expect(sprite).toHaveCount(0)
      await page.reload()
      await expect(frame).toContainText(lastText)
      await expect(counter).toHaveText('3 / 3')
      await expect(sprite).toHaveCount(0)
      expect((await data.get<Message>('messages', earlier.id)).absentCharacterIds).toEqual([])
      expect((await data.get<Message>('messages', latest.id)).absentCharacterIds).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(`.data/issue-256-${lastRole}-${width}.png`) })
    })
  }
}

test('presencia manual filtra recursos, conserva cuadros anteriores, partidas y transferencias', async ({ page, data }) => {
  const alicia = await data.createCharacter({ name: 'Alicia', prompt: 'Exploradora presente.' })
  const bruno = await data.createCharacter({ name: 'Bruno', prompt: 'Hermano conocido aunque esté fuera.' })
  await data.createImage(alicia, ['neutral'])
  await data.createImage(bruno, ['imagen-exclusiva-bruno'])
  await data.createSound(bruno, ['sonido-exclusivo-bruno'])
  const background = await data.createBackground({ tags: ['bosque'] })
  const story = await data.createStory({ characters: [alicia, bruno], background, title: 'Presencia conservada' })
  const earlier = await data.createMessage({ story, role: 'assistant', raw: 'Alicia [neutral]: Hola.\nBruno [imagen-exclusiva-bruno]: Buenos días.\nLa charla termina.', segments: [
    { type: 'dialogue', characterId: alicia.id, tag: 'neutral', text: 'Hola.' },
    { type: 'dialogue', characterId: bruno.id, tag: 'imagen-exclusiva-bruno', text: 'Buenos días.' },
    { type: 'narration', characterId: null, tag: null, text: 'La charla termina.' }
  ] })
  const requests: Array<Array<{ role: string; content: string }>> = []
  await page.route('**/api/llm/chat', async route => {
    requests.push(route.request().postDataJSON().messages)
    await route.fulfill({ json: { content: 'Fondo [bosque]:\nAlicia [neutral]: Seguimos sin Bruno.', finishReason: 'stop' } })
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/stories/' + story.id)
  await page.getByTestId('chat-scene-stage').getByRole('switch', { name: 'Presencia de Bruno' }).click()
  await expect.poll(async () => (await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([bruno.id])
  await page.screenshot({ path: resolve('.data/issue-251-chat.png') })
  await page.getByTestId('visual-mode-toggle').click()
  await expect(page.getByTestId('visual-novel-frame')).toContainText('La charla termina.')
  const sprites = page.getByTestId('visual-novel-cast')
  await expect(sprites.locator('[data-character-id="' + bruno.id + '"]')).toHaveCount(0)
  await page.getByTestId('visual-novel-previous').click()
  await expect(page.getByTestId('visual-novel-frame')).toContainText('Buenos días.')
  await expect(sprites.locator('[data-character-id="' + bruno.id + '"]')).toHaveCount(1)
  await page.getByTestId('story-end-button').click()
  await page.getByRole('textbox', { name: 'Tu intervención', exact: true }).fill('Seguimos.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect.poll(() => requests.length).toBe(1)
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible()
  const system = requests[0]![0]!.content
  expect(system).toContain('Hermano conocido aunque esté fuera.')
  expect(system).toContain('AUSENTE de la escena')
  expect(system).not.toContain('imagen-exclusiva-bruno')
  expect(system).not.toContain('sonido-exclusivo-bruno')
  const latest = (await data.list<Message>('messages', 'normal', { storyId: story.id })).filter((entry) => entry.role === 'assistant').at(-1)!
  expect(latest.absentCharacterIds).toEqual([bruno.id])
  expect((await data.get<Message>('messages', earlier.id)).absentCharacterIds).toEqual([])
  await expect(sprites.locator('[data-character-id="' + bruno.id + '"]')).toHaveCount(0)
  await page.screenshot({ path: resolve('.data/issue-251-novela.png') })
  const saveResponse = await page.request.post('/api/data/storySaves/' + story.id + '/create?scope=normal', { data: { name: 'Ausente', thumbnailDataUrl: 'data:image/webp;base64,UklGRg==' } })
  await expect(saveResponse).toBeOK()
  const slot = await saveResponse.json() as StorySaveSlot
  await page.getByTestId('story-tools-toggle').click()
  await page.getByTestId('story-presence-button').click()
  await page.getByRole('switch', { name: 'Presencia de Bruno' }).click()
  await expect.poll(async () => (await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([])
  await expect(await page.request.post('/api/data/storySaves/' + slot.id + '/load?scope=normal')).toBeOK()
  await page.reload()
  await expect(sprites.locator('[data-character-id="' + bruno.id + '"]')).toHaveCount(0)
  expect((await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([bruno.id])
  await page.goto('/settings')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar JSON' }).click()
  const exported = readFileSync((await (await downloadPromise).path())!, 'utf8')
  expect(JSON.parse(exported).version).toBe(27)
  await page.locator('input[accept="application/json"]').setInputFiles({ name: 'presence.json', mimeType: 'application/json', buffer: Buffer.from(exported) })
  await expect(page.getByText('Importación completada')).toBeVisible()
  const imported = (await data.list<Story>('stories')).find((entry) => entry.id !== story.id && entry.title === story.title)!
  const importedBrunoId = imported.characterCustomizations.find((entry) => entry.name === 'Bruno')!.characterId
  expect(imported.absentCharacterIds).toEqual([importedBrunoId])
  const importedMessages = await data.list<Message>('messages', 'normal', { storyId: imported.id })
  expect(importedMessages.at(-1)?.absentCharacterIds).toEqual([importedBrunoId])
  const importedSaves = await data.list<StorySaveSlot>('storySaves', 'normal', { storyId: imported.id })
  expect(importedSaves[0]?.story.absentCharacterIds).toEqual([importedBrunoId])
  expect(importedSaves[0]?.messages.at(-1)?.absentCharacterIds).toEqual([importedBrunoId])
})

test('Más opciones y diálogo de personajes caben en ambas vistas y anchos intermedios', async ({ page, data }) => {
  const character = await data.createCharacter({ name: 'Alicia' })
  await data.createImage(character)
  const story = await data.createStory({ characters: [character], visualMode: true, absentCharacterIds: [character.id] })
  await page.goto('/stories/' + story.id)
  for (const width of [320, 390, 639, 640, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 800 })
    for (const visualMode of [true, false]) {
      if ((await data.get<Story>('stories', story.id)).visualMode !== visualMode) await page.getByTestId('visual-mode-toggle').click()
      await page.getByTestId('story-tools-toggle').click()
      await page.getByTestId('story-presence-button').click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      const box = await dialog.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (width === 320 && visualMode) await page.screenshot({ path: resolve('.data/issue-251-mobile.png') })
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    }
  }
})

test('guardado lento bloquea generación y la espera del narrador no hace reaparecer ausentes', async ({ page, data }) => {
  const character = await data.createCharacter({ name: 'Bruno' })
  await data.createImage(character)
  const story = await data.createStory({ characters: [character] })
  await data.createMessage({ story, role: 'assistant', raw: 'Bruno [neutral]: Hola.', segments: [{ type: 'dialogue', characterId: character.id, tag: 'neutral', text: 'Hola.' }] })
  let releaseSave!: () => void
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve })
  let saving = false
  await page.route('**/api/data/stories/' + story.id + '?*', async route => {
    if (route.request().method() === 'PUT' && route.request().postDataJSON().absentCharacterIds?.length) { saving = true; await saveGate }
    await route.continue()
  })
  let releaseReply!: () => void
  const replyGate = new Promise<void>((resolve) => { releaseReply = resolve })
  let requesting = false
  await page.route('**/api/llm/chat', async route => {
    requesting = true
    await replyGate
    await route.fulfill({ json: { content: 'Esperamos en silencio.', finishReason: 'stop' } })
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/stories/' + story.id)
  await page.getByRole('textbox', { name: 'Tu intervención', exact: true }).fill('Esperamos.')
  await page.getByRole('switch', { name: 'Presencia de Bruno' }).click()
  await expect.poll(() => saving).toBe(true)
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeDisabled()
  await expect(page.getByTestId('continue-button')).toBeDisabled()
  await expect(page.getByTestId('auto-button')).toBeDisabled()
  await page.getByRole('textbox', { name: 'Tu intervención', exact: true }).press('Control+Enter')
  expect(requesting).toBe(false)
  releaseSave()
  await expect(page.getByRole('switch', { name: 'Presencia de Bruno' })).toHaveAttribute('aria-checked', 'false')
  await page.getByTestId('visual-mode-toggle').click()
  await page.getByTestId('continue-button').click()
  await expect.poll(() => requesting).toBe(true)
  await expect(page.getByTestId('visual-novel-cast').locator('figure')).toHaveCount(0)
  await expect(page.getByTestId('visual-novel-frame')).toContainText('Hola.')
  releaseReply()
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible()
  await expect(page.getByTestId('visual-novel-cast').locator('figure')).toHaveCount(0)
})

test('fallo al guardar conserva presencia anterior y permite reintentar', async ({ page, data }) => {
  const character = await data.createCharacter({ name: 'Bruno' })
  const story = await data.createStory({ characters: [character] })
  const url = '**/api/data/stories/' + story.id + '?*'
  await page.route(url, async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 500, json: { message: 'Fallo de prueba' } })
    else await route.continue()
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/stories/' + story.id)
  const toggle = page.getByRole('switch', { name: 'Presencia de Bruno' })
  await toggle.click()
  await expect(page.getByRole('alert')).toContainText('No se pudo guardar la presencia')
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  expect((await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([])
  await page.unroute(url)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('regenerar un cuadro anterior recupera su presencia sin heredar la ausencia posterior', async ({ page, data }) => {
  const character = await data.createCharacter({ name: 'Bruno' })
  await data.createImage(character, ['neutral'])
  const story = await data.createStory({ characters: [character], absentCharacterIds: [character.id] })
  const message = await data.createMessage({ story, absentCharacterIds: [], role: 'assistant', raw: 'Bruno [neutral]: Hola.', segments: [{ type: 'dialogue', characterId: character.id, tag: 'neutral', text: 'Hola.' }] })
  let system = ''
  await page.route('**/api/llm/chat', async route => {
    system = route.request().postDataJSON().messages[0].content
    await route.fulfill({ json: { content: 'Bruno [neutral]: Otra versión.', finishReason: 'stop' } })
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/stories/' + story.id)
  const bubble = page.locator('[data-story-message-id="' + message.id + '"]')
  await bubble.hover()
  await bubble.getByRole('button', { name: 'Regenerar desde este mensaje', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Regenerar', exact: true }).click()
  await expect.poll(() => system).toContain('Estado: PRESENTE en la escena.')
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible()
  expect((await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([])
  const regenerated = (await data.list<Message>('messages', 'normal', { storyId: story.id })).at(-1)!
  expect(regenerated.absentCharacterIds).toEqual([])
})

test('historia de solo lectura oculta controles de presencia', async ({ page, data }) => {
  const character = await data.createCharacter({ name: 'Bruno' })
  const story = await data.createStory({ characters: [character], absentCharacterIds: [character.id] })
  await page.route('**/api/data/stories**', async route => {
    const response = await route.fetch()
    const result = await response.json()
    const readonly = (entry: Story) => entry.id === story.id ? { ...entry, readOnly: true } : entry
    await route.fulfill({ response, json: Array.isArray(result) ? result.map(readonly) : readonly(result) })
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/stories/' + story.id)
  await expect(page.getByRole('switch')).toHaveCount(0)
  await page.getByTestId('story-tools-toggle').click()
  await expect(page.getByTestId('story-presence-button')).toHaveCount(0)
})
