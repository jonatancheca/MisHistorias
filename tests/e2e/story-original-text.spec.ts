import { readFileSync } from 'node:fs'
import type { LlmDebugTrace, Message, Story, StorySaveSlot } from '../../shared/types'
import { expect, test } from './fixtures'

test.beforeEach(async ({ data }) => {
  await data.patchSettings({ mockMode: true, responseSpeed: 'instant', visualNovelManualAdvance: false })
})

test('original por mensaje, junto a debug, conservado entre vistas y temporal', async ({ page, data }) => {
  const story = await data.createStory({ characters: [] })
  const user = await data.createMessage({ story, role: 'user', raw: 'Entro [con cuidado].' })
  const raw = 'Primera [susurra] frase.\n\nSegunda [nota] frase. <b>literal</b>'
  const assistant = await data.createMessage({
    story, role: 'assistant', raw,
    segments: [
      { type: 'narration', text: 'Primera [susurra] frase.' },
      { type: 'narration', text: 'Segunda [nota] frase. <b>literal</b>' }
    ]
  })
  const trace: LlmDebugTrace = {
    id: data.unique('trace'), storyId: story.id, responseMessageId: assistant.id,
    status: 'success', createdAt: Date.now(),
    request: { provider: 'lmstudio', model: 'test', messages: [], temperature: 0.7, max_tokens: 100, stream: false },
    response: { content: raw, finishReason: 'stop' }
  }
  await expect(await page.request.put(`/api/data/llmDebugTraces/${trace.id}?scope=normal`, { data: trace })).toBeOK()
  const stored = await data.get<Message>('messages', assistant.id)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/stories/${story.id}`)
  const bubble = page.locator(`[data-story-message-id="${assistant.id}"]`)
  const userBubble = page.locator(`[data-story-message-id="${user.id}"]`)
  await bubble.hover()
  const toggle = bubble.getByTestId('story-original-toggle')
  const toggleBounds = await toggle.boundingBox()
  const debugBounds = await bubble.getByRole('button', { name: 'Ver datos de debug de la llamada LLM' }).boundingBox()
  expect(toggleBounds!.x + toggleBounds!.width).toBeLessThanOrEqual(debugBounds!.x)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(bubble.getByTestId('story-original-text').locator('pre')).toHaveText(raw)
  await expect(bubble.getByTestId('story-original-text').locator('b')).toHaveCount(0)
  await expect(userBubble.getByTestId('story-original-text')).toHaveCount(0)

  await page.getByTestId('visual-mode-toggle').click()
  const visual = page.getByTestId('visual-novel-view')
  await expect(visual.getByTestId('story-original-text').locator('pre')).toHaveText(raw)
  const counter = await page.getByTestId('visual-novel-counter').innerText()
  await page.getByTestId('visual-novel-frame').hover()
  await page.screenshot({ path: test.info().outputPath('original-desktop.png') })
  await visual.getByTestId('story-original-toggle').click()
  await expect(visual.getByTestId('story-original-text')).toHaveCount(0)
  await expect(page.getByTestId('visual-novel-counter')).toHaveText(counter)
  await page.getByTestId('visual-mode-toggle').click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await bubble.hover()
  await toggle.click()
  expect(await data.get<Message>('messages', assistant.id)).toEqual(stored)
  await page.reload()
  await expect(bubble.getByTestId('story-original-text')).toHaveCount(0)
})

test('mensajes sin cuadro accesibles sin cambiar la secuencia visual', async ({ page, data }) => {
  const story = await data.createStory({ characters: [], visualMode: true })
  const instruction = await data.createMessage({ story, role: 'user', raw: 'IA: Habla [en secreto].' })
  const brackets = await data.createMessage({ story, role: 'user', raw: '[Solo una anotación]' })
  const background = await data.createMessage({
    story, role: 'assistant', raw: 'Fondo [bosque]: Texto omitido del fondo.',
    segments: [{ type: 'background', tag: 'bosque', backgroundId: null, text: 'Texto omitido del fondo.' }]
  })
  await data.createMessage({
    story, role: 'assistant', raw: 'Texto [anotación] visible.',
    segments: [{ type: 'narration', text: 'Texto [anotación] visible.' }]
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/stories/${story.id}`)
  await expect(page.getByTestId('visual-novel-counter')).toHaveText('1 / 1')
  await page.getByRole('button', { name: 'Ver mensajes sin cuadro' }).click()
  const dialog = page.getByRole('dialog', { name: 'Mensajes sin cuadro' })
  for (const message of [instruction, brackets, background]) {
    const row = dialog.locator(`[data-hidden-message-id="${message.id}"]`)
    await row.getByTestId('story-original-toggle').click()
    await expect(row.getByTestId('story-original-text').locator('pre')).toHaveText(message.originalRaw ?? message.raw)
  }
  await dialog.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('visual-novel-counter')).toHaveText('1 / 1')
  await expect(page.getByTestId('visual-novel-frame')).toContainText('Texto visible.')
  await page.getByTestId('visual-mode-toggle').click()
  const instructionBubble = page.locator(`[data-story-message-id="${instruction.id}"]`)
  await expect(instructionBubble).toContainText('Contenido oculto')
  await expect(instructionBubble.getByTestId('story-original-text').locator('pre')).toHaveText(instruction.raw)
  await instructionBubble.hover()
  await instructionBubble.getByTestId('story-original-toggle').click()
  await expect(instructionBubble).not.toContainText(instruction.raw)
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 760 })
    await expect(page.getByTestId('story-original-toggle')).toHaveCount(0)
    await expect(page.getByTestId('story-original-text')).toHaveCount(0)
    await expect(instructionBubble).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByTestId('visual-mode-toggle').evaluate((button: HTMLButtonElement) => button.click())
    await expect(page.getByTestId('story-hidden-messages-button')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByTestId('visual-mode-toggle').evaluate((button: HTMLButtonElement) => button.click())
  }
})

test('consulta el original recibido durante el revelado sin avanzar la novela', async ({ page, data }) => {
  const story = await data.createStory({ characters: [], visualMode: true, autoGenerateImages: true })
  const content = 'Imagen Alicia [neutral]: portrait.\nPrimera [secreta] frase.\nSegunda [otra] frase.'
  await data.patchSettings({ mockMode: false, useChromeLlm: false, model: 'test', responseSpeed: 'slow', visualNovelManualAdvance: true })
  await page.route('**/api/llm/chat', (route) => route.fulfill({ json: { content, finishReason: 'stop' } }))
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/stories/${story.id}`)
  await page.getByPlaceholder('Escribe lo que haces o dices…').fill('Empieza.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  const frame = page.getByTestId('visual-novel-frame')
  await expect(frame).toHaveText('Primera frase.', { timeout: 20_000 })
  const counter = await page.getByTestId('visual-novel-counter').innerText()
  const visual = page.getByTestId('visual-novel-view')
  await frame.hover()
  await visual.getByTestId('story-original-toggle').click()
  await expect(visual.getByTestId('story-original-text').locator('pre')).toHaveText(content)
  await expect(frame).toHaveText('Primera frase.')
  await expect(page.getByTestId('visual-novel-counter')).toHaveText(counter)
  await visual.getByTestId('story-original-toggle').click()
  await expect(frame).toHaveText('Primera frase.')
  await page.getByTestId('visual-novel-next').click()
  await expect(frame).toHaveText('Segunda frase.', { timeout: 20_000 })
})

for (const visualMode of [false, true]) {
  test(`original disponible en historia privada/demo de solo lectura, visual=${visualMode}`, async ({ page, data }) => {
    const story = await data.createStory({ characters: [], visualMode, scope: 'private', visibleInDemo: true })
    const message = await data.createMessage({
      story, scope: 'private', role: 'assistant', raw: 'Texto [oculto] compartido.',
      originalRaw: 'Imagen Alicia [neutral]: Original privado.\nTexto [oculto] compartido.',
      segments: [{ type: 'narration', text: 'Texto [oculto] compartido.' }]
    })
    await page.route('**/api/data/stories?*', async (route) => {
      const response = await route.fetch()
      const stories = await response.json() as Story[]
      await route.fulfill({ response, json: stories.map((entry) => entry.id === story.id ? { ...entry, readOnly: true } : entry) })
    })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/settings')
    const privateTrigger = page.getByRole('button', { name: 'Activar modo privado' })
    for (let click = 0; click < 3; click++) await privateTrigger.click()
    await expect(page.locator('html')).toHaveClass(/private-scope/)
    await page.getByRole('link', { name: 'Historias', exact: true }).click()
    await page.getByRole('link', { name: story.title, exact: true }).click()
    await expect(page.getByRole('button', { name: 'Editar mensaje' })).toHaveCount(0)
    const area = visualMode ? page.getByTestId('visual-novel-view') : page.getByTestId('story-scroller')
    await area.hover()
    await area.getByTestId('story-original-toggle').click()
    await expect(area.getByTestId('story-original-text').locator('pre')).toHaveText(message.originalRaw ?? message.raw)
    await page.locator('main').press('Control+Alt+d')
    await expect(page.locator('html')).toHaveClass(/demo-scope/)
    await area.hover()
    await expect(area.getByTestId('story-original-toggle')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Editar mensaje' })).toHaveCount(0)
  })
}

for (const visualMode of [false, true]) {
  test(`respuesta completa con Imagen conservada al editar, recargar y transferir, visual=${visualMode}`, async ({ page, data }) => {
    const character = await data.createCharacter({ name: 'Alicia' })
    const story = await data.createStory({ characters: [character], visualMode, autoGenerateImages: true })
    const content = 'Imagen Alicia [neutral]: portrait.\nPrimera [secreta] frase.\nSegunda [otra] frase.'
    await data.patchSettings({ mockMode: false, useChromeLlm: false, model: 'test', maxTokens: 100, contextTokenBudget: 0, historyBudget: 0, swarmBaseUrl: '' })
    await page.route('**/api/llm/chat', route => route.fulfill({ json: { content, finishReason: 'stop' } }))
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/stories/${story.id}`)
    await page.getByRole('textbox', { name: 'Tu intervención', exact: true }).fill('Empieza.')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    const storedMessages = () => data.list<Message>('messages', 'normal', { storyId: story.id })
    await expect.poll(async () => (await storedMessages()).find(message => message.role === 'assistant')?.originalRaw).toBe(content)
    const response = (await storedMessages()).find(message => message.role === 'assistant')!
    expect(response.raw).not.toContain('Imagen Alicia')
    const area = visualMode ? page.getByTestId('visual-novel-view') : page.locator(`[data-story-message-id="${response.id}"]`)
    await area.hover()
    await area.getByTestId('story-original-toggle').click()
    await expect(area.getByTestId('story-original-text').locator('pre')).toHaveText(content)
    if (visualMode) {
      await page.getByTestId('visual-novel-next').click()
      await expect(area.getByTestId('story-original-text').locator('pre')).toHaveText(content)
      await page.getByTestId('visual-novel-previous').click()
      await expect(area.getByTestId('story-original-text').locator('pre')).toHaveText(content)
      await page.getByTestId('visual-mode-toggle').click()
    }
    const bubble = page.locator(`[data-story-message-id="${response.id}"]`)
    await bubble.hover()
    await bubble.getByRole('button', { name: 'Editar mensaje' }).click()
    await bubble.locator('textarea').fill('Narración editada.')
    await bubble.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(bubble.getByTestId('story-original-text').locator('pre')).toHaveText(content)
    await page.reload()
    await bubble.hover()
    await bubble.getByTestId('story-original-toggle').click()
    await expect(bubble.getByTestId('story-original-text').locator('pre')).toHaveText(content)
    const edited = (await storedMessages()).find(message => message.id === response.id)!
    expect(edited.raw).toBe('Narración editada.')
    expect(edited.originalRaw).toBe(content)
    const saveResponse = await page.request.post(`/api/data/storySaves/${story.id}/create?scope=normal`, { data: { name: 'Original conservado', thumbnailDataUrl: 'data:image/webp;base64,UklGRg==' } })
    await expect(saveResponse).toBeOK()
    await page.goto('/settings')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exportar JSON' }).click()
    const exported = readFileSync((await (await downloadPromise).path())!, 'utf8')
    await page.locator('input[accept="application/json"]').setInputFiles({ name: 'original.json', mimeType: 'application/json', buffer: Buffer.from(exported) })
    await expect(page.getByText('Importación completada')).toBeVisible()
    const imported = (await data.list<Story>('stories')).find(entry => entry.id !== story.id && entry.title === story.title)!
    const importedMessages = await data.list<Message>('messages', 'normal', { storyId: imported.id })
    expect(importedMessages.find(message => message.role === 'assistant')?.originalRaw).toBe(content)
    const saves = await data.list<StorySaveSlot>('storySaves', 'normal', { storyId: imported.id })
    expect(saves[0]?.messages.find(message => message.role === 'assistant')?.originalRaw).toBe(content)
    await page.goto(`/stories/${imported.id}`)
    const importedBubble = page.locator(`[data-story-message-id="${importedMessages.find(message => message.role === 'assistant')!.id}"]`)
    await importedBubble.hover()
    await importedBubble.getByTestId('story-original-toggle').click()
    await expect(importedBubble.getByTestId('story-original-text').locator('pre')).toHaveText(content)
    for (const width of [320, 390, 639, 640, 768]) {
      await page.setViewportSize({ width, height: 800 })
      if (width < 640) {
        const showMenu = page.getByRole('button', { name: 'Mostrar menú de historia' })
        if (await showMenu.isVisible()) await showMenu.click()
        await page.getByTestId('story-tools-toggle').click()
        await page.getByTestId('story-debug-toggle').click()
      }
      await importedBubble.hover()
      if (await importedBubble.getByTestId('story-original-toggle').getAttribute('aria-pressed') === 'false') await importedBubble.getByTestId('story-original-toggle').click()
      await expect(importedBubble.getByTestId('story-original-text').locator('pre')).toHaveText(content)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      if (width === 320) await page.screenshot({ path: '.data/issue-249-mobile.png' })
      if (width < 640) {
        const showMenu = page.getByRole('button', { name: 'Mostrar menú de historia' })
        if (await showMenu.isVisible()) await showMenu.click()
        await page.getByTestId('story-tools-toggle').click()
        await page.getByTestId('story-debug-toggle').click()
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    await importedBubble.hover()
    await page.screenshot({ path: '.data/issue-249-chat.png' })
    await page.getByTestId('visual-mode-toggle').click()
    await page.getByTestId('visual-novel-frame').hover()
    await expect(page.getByTestId('visual-novel-view').getByTestId('story-original-text').locator('pre')).toHaveText(content)
    await page.screenshot({ path: '.data/issue-249-novela.png' })
  })
}

test('respuesta antigua recupera original completo desde su traza disponible', async ({ page, data }) => {
  const story = await data.createStory({ characters: [] })
  const message = await data.createMessage({ story, role: 'assistant', raw: 'Narración conservada.', segments: [{ type: 'narration', text: 'Narración conservada.' }] })
  const originalRaw = 'Imagen Alicia [neutral]: portrait.\nNarración conservada.'
  const trace: LlmDebugTrace = {
    id: data.unique('trace'), storyId: story.id, responseMessageId: message.id, status: 'success', createdAt: Date.now(),
    request: { model: 'test', messages: [], temperature: 0.7, max_tokens: 100, stream: false }, response: { content: originalRaw, finishReason: 'stop' }
  }
  await expect(await page.request.put(`/api/data/llmDebugTraces/${trace.id}?scope=normal`, { data: trace })).toBeOK()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/stories/${story.id}`)
  const bubble = page.locator(`[data-story-message-id="${message.id}"]`)
  await bubble.hover()
  await bubble.getByTestId('story-original-toggle').click()
  await expect(bubble.getByTestId('story-original-text').locator('pre')).toHaveText(originalRaw)
  await page.getByTestId('visual-mode-toggle').click()
  await expect(page.getByTestId('visual-novel-view').getByTestId('story-original-text').locator('pre')).toHaveText(originalRaw)
})
