import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Message, Story, StorySaveSlot } from '../../shared/types'
import { expect, test } from './fixtures'

test.beforeEach(async ({ request, data }) => {
  await expect(await request.post('/api/data/clear?scope=normal')).toBeOK()
  await data.patchSettings({ mockMode: false, useChromeLlm: false, privateUseChromeLlm: null, model: 'test',
    privateHistoryBudget: 0, privateContextTokenBudget: 0, privateMaxTokens: 100,
    userName: 'Vera', responseSpeed: 'instant', visualNovelManualAdvance: false,
    historyBudget: 0, contextTokenBudget: 0, maxTokens: 100, swarmBaseUrl: '' })
})

for (const scope of ['normal', 'private'] as const) {
  for (const visualMode of [false, true]) {
    test(`salidas y retornos en orden, sin cuadros y con presencia histórica (${scope}, ${visualMode ? 'Novela' : 'Chat'})`, async ({ page, data }) => {
      const lia = await data.createCharacter({ name: 'Alicia', scope })
      const bruno = await data.createCharacter({ name: 'Bruno', scope })
      await data.createImage(lia, ['aspecto-lia'], scope)
      const brunoImage = await data.createImage(bruno, ['aspecto-bruno'], scope)
      const original = await data.createStory({ characters: [lia, bruno], absentCharacterIds: [bruno.id], visualMode, scope })
      const story = { ...original, characterCustomizations: original.characterCustomizations.map((entry) => entry.characterId === lia.id ? { ...entry, name: 'Lía' } : entry) }
      await expect(await page.request.put('/api/data/stories/' + story.id + '?scope=' + scope, { data: story })).toBeOK()
      const earlier = await data.createMessage({ story, role: 'assistant', raw: 'Lía: Texto antiguo.', scope,
        segments: [{ type: 'dialogue', characterId: lia.id, tag: null, text: 'Texto antiguo.' }] })
      let system = ''
      const content = 'Antes.\nAusente Lia:\nDespués.\nPresente Bruno:\nAl volver.\nAusente Bruno:\nBruno: He vuelto.\nAusente Lía:'
      await page.route('**/api/llm/chat', (route) => {
        system = route.request().postDataJSON().messages[0].content
        return route.fulfill({ json: { content, finishReason: 'stop' } })
      })
      if (scope === 'private') {
        await page.goto('/')
        await page.locator('main').press('Control+Alt+p')
        await expect(page.locator('html')).toHaveClass(/private-scope/)
        await page.locator(`a[href="/stories/${story.id}"]`).first().click()
      } else await page.goto('/stories/' + story.id)
      await page.getByTestId('continue-button').click()
      await expect.poll(async () => (await data.get<Story>('stories', story.id, scope)).absentCharacterIds).toEqual([lia.id])
      await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible()
      const saved = (await data.list<Message>('messages', scope, { storyId: story.id })).at(-1)!
      expect(saved.originalRaw).toBe(content)
      expect(saved.absentCharacterIds).toEqual([bruno.id])
      expect(saved.segments[3]).toMatchObject({ type: 'character-present', characterId: bruno.id, imageId: brunoImage.id, presenceApplied: true })
      expect(saved.segments[6]?.returnsToScene).toBe(true)
      expect(system).toContain('Ausente Nombre:')
      expect(system).toContain('Presente Nombre:')
      expect(system).not.toContain('aspecto-bruno')
      expect((await data.get<Message>('messages', earlier.id, scope)).absentCharacterIds).toEqual([bruno.id])
      if (!visualMode) {
        await expect(page.getByTestId('story-scroller')).not.toContainText('Ausente Lia:')
        await expect(page.getByTestId('story-scroller')).not.toContainText('Presente Bruno:')
        if (scope === 'normal') await page.screenshot({ path: resolve('.data/issue-261-chat.png') })
        await page.getByTestId('visual-mode-toggle').click()
      }
      if (await page.getByTestId('story-end-button').isEnabled()) await page.getByTestId('story-end-button').click()
      const sprites = page.getByTestId('visual-novel-cast')
      await expect(page.getByTestId('visual-novel-frame')).toContainText('He vuelto.')
      await expect(sprites.locator('[data-character-id="' + lia.id + '"]')).toHaveCount(0)
      await expect(sprites.locator('[data-character-id="' + bruno.id + '"] img')).toBeVisible()
      await page.getByTestId('visual-novel-previous').click()
      await expect(page.getByTestId('visual-novel-frame')).toContainText('Al volver.')
      await expect(sprites.locator('[data-character-id="' + bruno.id + '"] img')).toBeVisible()
      await page.getByTestId('visual-novel-previous').click()
      await expect(page.getByTestId('visual-novel-frame')).toContainText('Después.')
      await expect(sprites.locator('[data-character-id]')).toHaveCount(0)
      await page.getByTestId('visual-novel-previous').click()
      await expect(page.getByTestId('visual-novel-frame')).toContainText('Antes.')
      await expect(sprites.locator('[data-character-id="' + lia.id + '"] img')).toBeVisible()
      await page.getByTestId('visual-novel-previous').click()
      await expect(page.getByTestId('visual-novel-frame')).toContainText('Texto antiguo.')
      await expect(sprites.locator('[data-character-id="' + lia.id + '"] img')).toBeVisible()
      await page.getByTestId('story-end-button').click()
      for (const width of [320, 390, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        await expect(sprites.locator('[data-character-id="' + bruno.id + '"] img')).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        if (scope === 'normal' && visualMode && width === 390) await page.screenshot({ path: resolve('.data/issue-261-novela-390.png') })
      }
      await page.reload()
      if (scope === 'private') {
        await page.goto('/')
        await page.locator('main').press('Control+Alt+p')
        await expect(page.locator('html')).toHaveClass(/private-scope/)
        await page.locator(`a[href="/stories/${story.id}"]`).first().click()
      }
      await expect(sprites.locator('[data-character-id="' + bruno.id + '"] img')).toBeVisible()
      expect((await data.get<Story>('stories', story.id, scope)).absentCharacterIds).toEqual([lia.id])
    })
  }
}

test('solo instrucciones: retorno sin diálogo, salida final, sin pasos ni reintentos', async ({ page, data }) => {
  const character = await data.createCharacter({ name: 'Bruno' })
  await data.createImage(character)
  const story = await data.createStory({ characters: [character], absentCharacterIds: [character.id], visualMode: true })
  await data.createMessage({ story, role: 'assistant', raw: 'Seguimos aquí.', segments: [{ type: 'narration', characterId: null, tag: null, text: 'Seguimos aquí.' }] })
  let calls = 0
  await page.route('**/api/llm/chat', route => route.fulfill({ json: { content: ++calls === 1 ? 'Presente Bruno:' : 'Ausente Bruno:', finishReason: 'stop' } }))
  await page.goto('/stories/' + story.id)
  const sprites = page.getByTestId('visual-novel-cast').locator('[data-character-id="' + character.id + '"]')
  await expect(sprites).toHaveCount(0)
  await page.getByTestId('continue-button').click()
  await expect.poll(async () => (await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([])
  await expect(sprites.locator('img')).toBeVisible()
  await expect(page.getByTestId('visual-novel-frame')).toContainText('Seguimos aquí.')
  await expect(page.getByTestId('visual-novel-previous')).toBeDisabled()
  await expect(page.getByTestId('visual-novel-next')).toBeDisabled()
  expect(calls).toBe(1)
  await page.getByTestId('continue-button').click()
  await expect.poll(async () => (await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([character.id])
  await expect(sprites).toHaveCount(0)
  await expect(page.getByTestId('visual-novel-frame')).toContainText('Seguimos aquí.')
  expect(calls).toBe(2)
  const messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
  expect(messages.at(-1)?.originalRaw).toBe('Ausente Bruno:')
  await page.getByTestId('story-hidden-messages-button').click()
  await page.getByRole('dialog').locator('[data-hidden-message-id="' + messages.at(-1)!.id + '"]').getByRole('button', { name: 'Mostrar texto original', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Ausente Bruno:')
})

test('Stop conserva entradas completas y no ejecuta una salida todavía no presentada', async ({ page, data }) => {
  const character = await data.createCharacter({ name: 'Bruno' })
  const story = await data.createStory({ characters: [character], absentCharacterIds: [character.id] })
  await data.patchSettings({ responseSpeed: 'slow' })
  const content = 'Presente Bruno:\nRegreso lentamente. ' + 'Esperamos. '.repeat(180) + '\nAusente Bruno:'
  await page.route('**/api/llm/chat', route => route.fulfill({ json: { content, finishReason: 'stop' } }))
  await page.goto('/stories/' + story.id)
  await page.getByRole('textbox', { name: 'Tu intervención', exact: true }).fill('Continúa.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByTestId('story-scroller')).toContainText('Regreso lentamente.')
  await expect(page.getByTestId('story-scroller')).not.toContainText('Presente Bruno:')
  expect((await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([character.id])
  await page.getByRole('button', { name: 'Parar', exact: true }).first().click()
  await expect.poll(async () => (await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([])
  const saved = (await data.list<Message>('messages', 'normal', { storyId: story.id })).at(-1)!
  expect(saved.segments[0]).toMatchObject({ type: 'character-present', presenceApplied: true })
  expect(saved.raw).not.toContain('Ausente Bruno:')
  expect(saved.originalRaw).toBe(content)
})

for (const mode of ['opening', 'continue', 'auto', 'regenerate'] as const) {
  test(`ausencia explícita en ${mode}, parcial por tokens e instrucciones inválidas`, async ({ page, data }) => {
    const character = await data.createCharacter({ name: 'Bruno' })
    const story = await data.createStory({ characters: [character] })
    const earlier = mode === 'opening' ? null : await data.createMessage({ story, role: 'assistant', raw: 'Esperamos.', segments: [{ type: 'narration', characterId: null, tag: null, text: 'Esperamos.' }] })
    await page.route('**/api/llm/chat', route => route.fulfill({ json: { content: 'Ausente Vera:\nPresente Nadie:\nAusente Bruno:\nFuera de escena.\nPresente Bruno', finishReason: 'length' } }))
    await page.goto('/stories/' + story.id)
    if (mode === 'opening') await page.getByRole('button', { name: 'Deja que la história empiece sola' }).first().click()
    else if (mode === 'regenerate') {
      const bubble = page.locator('[data-story-message-id="' + earlier!.id + '"]')
      await bubble.hover()
      await bubble.getByRole('button', { name: 'Regenerar desde este mensaje', exact: true }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Regenerar', exact: true }).click()
    } else await page.getByTestId(mode === 'auto' ? 'auto-button' : 'continue-button').click()
    await expect.poll(async () => (await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([character.id])
    await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible()
    const saved = (await data.list<Message>('messages', 'normal', { storyId: story.id })).at(-1)!
    expect(saved.segments.filter((segment) => segment.presenceApplied)).toHaveLength(1)
    expect(saved.segments.at(-1)?.characterId).toBeNull()
    await expect(page.getByTestId('story-scroller')).not.toContainText('Presente Bruno')
  })
}

test('presencia, originales y efectos sobreviven a partidas y transferencia con IDs nuevos', async ({ page, data }) => {
  const character = await data.createCharacter({ name: 'Bruno' })
  await data.createImage(character)
  const story = await data.createStory({ characters: [character] })
  await data.createMessage({ story, role: 'assistant', raw: 'Esperamos.', segments: [{ type: 'narration', characterId: null, tag: null, text: 'Esperamos.' }] })
  await page.route('**/api/llm/chat', route => route.fulfill({ json: { content: 'Ausente Bruno:', finishReason: 'stop' } }))
  await page.goto('/stories/' + story.id)
  await page.getByTestId('continue-button').click()
  await expect.poll(async () => (await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([character.id])
  const saveResponse = await page.request.post('/api/data/storySaves/' + story.id + '/create?scope=normal', { data: { name: 'Salida', thumbnailDataUrl: 'data:image/webp;base64,UklGRg==' } })
  await expect(saveResponse).toBeOK()
  const slot = await saveResponse.json() as StorySaveSlot
  await expect(await page.request.put('/api/data/stories/' + story.id + '?scope=normal', { data: { ...await data.get<Story>('stories', story.id), absentCharacterIds: [] } })).toBeOK()
  await expect(await page.request.post('/api/data/storySaves/' + slot.id + '/load?scope=normal')).toBeOK()
  expect((await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([character.id])
  await page.goto('/settings')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar JSON' }).click()
  const exported = readFileSync((await (await downloadPromise).path())!, 'utf8')
  await page.locator('input[accept="application/json"]').setInputFiles({ name: 'presence261.json', mimeType: 'application/json', buffer: Buffer.from(exported) })
  await expect(page.getByText('Importación completada')).toBeVisible()
  const imported = (await data.list<Story>('stories')).find((entry) => entry.id !== story.id && entry.title === story.title)!
  const importedId = imported.characterIds[0]!
  expect(imported.absentCharacterIds).toEqual([importedId])
  const importedMessages = await data.list<Message>('messages', 'normal', { storyId: imported.id })
  expect(importedMessages.at(-1)?.segments[0]).toMatchObject({ type: 'character-absent', characterId: importedId, presenceApplied: true })
  expect(importedMessages.at(-1)?.originalRaw).toBe('Ausente Bruno:')
  const importedSaves = await data.list<StorySaveSlot>('storySaves', 'normal', { storyId: imported.id })
  expect(importedSaves[0]?.messages.at(-1)?.segments[0]?.characterId).toBe(importedId)
})


test('editar no crea efectos nuevos y regenerar restaura la presencia inicial', async ({ page, data }) => {
  const character = await data.createCharacter({ name: 'Bruno' })
  const story = await data.createStory({ characters: [character] })
  const earlier = await data.createMessage({ story, role: 'assistant', raw: 'Esperamos.', segments: [{ type: 'narration', characterId: null, tag: null, text: 'Esperamos.' }] })
  let calls = 0
  await page.route('**/api/llm/chat', route => route.fulfill({ json: { content: ++calls === 1 ? 'Ausente Bruno:' : 'Todavía aquí.', finishReason: 'stop' } }))
  await page.goto('/stories/' + story.id)
  await page.getByTestId('continue-button').click()
  await expect.poll(async () => (await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([character.id])
  const generated = (await data.list<Message>('messages', 'normal', { storyId: story.id })).at(-1)!
  const bubble = page.locator('[data-story-message-id="' + earlier.id + '"]')
  await bubble.hover()
  await bubble.getByRole('button', { name: 'Editar mensaje', exact: true }).click()
  await bubble.locator('textarea').fill('Esperamos.\nPresente Bruno:')
  await bubble.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(bubble.locator('textarea')).toHaveCount(0)
  const edited = await data.get<Message>('messages', earlier.id)
  expect(edited.segments.at(-1)?.presenceApplied).toBeUndefined()
  expect((await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([character.id])
  await page.reload()
  expect((await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([character.id])
  const hidden = page.locator('[data-story-message-id="' + generated.id + '"]')
  await hidden.hover()
  await hidden.getByRole('button', { name: 'Regenerar desde este mensaje', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Regenerar', exact: true }).click()
  await expect.poll(() => calls).toBe(2)
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible()
  expect((await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([])
  expect((await data.list<Message>('messages', 'normal', { storyId: story.id })).at(-1)?.absentCharacterIds).toEqual([])
})
