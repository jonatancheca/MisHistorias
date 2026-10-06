import { resolve } from 'node:path'
import type { Message, Story } from '../../shared/types'
import { expect, test } from './fixtures'

test.beforeEach(async ({ request, data }) => {
  await expect(await request.post('/api/data/clear?scope=normal')).toBeOK()
  await data.patchSettings({ mockMode: false, useChromeLlm: false, privateUseChromeLlm: null, model: 'test',
    privateHistoryBudget: 0, privateContextTokenBudget: 0, privateMaxTokens: 100,
    userName: 'Vera', responseSpeed: 'instant', visualNovelManualAdvance: false,
    historyBudget: 0, contextTokenBudget: 0, maxTokens: 100, swarmBaseUrl: '' })
})

for (const scope of ['normal', 'private'] as const) {
  for (const kind of ['dialogue', 'thought'] as const) {
    test(`retorno por ${kind} conserva historial, nombre personalizado, recursos y recarga (${scope})`, async ({ page, data }) => {
      const lia = await data.createCharacter({ name: 'Alicia', scope })
      const bruno = await data.createCharacter({ name: 'Bruno', scope })
      const image = await data.createImage(lia, ['aspecto-lia'], scope)
      await data.createImage(bruno, ['aspecto-bruno'], scope)
      const soundTag = data.unique('sonido-bruno')
      await data.createSound(bruno, [soundTag], scope)
      const original = await data.createStory({ characters: [lia, bruno], absentCharacterIds: [lia.id, bruno.id],
        visualMode: kind === 'thought', scope, title: 'Regreso a la escena' })
      const response = await page.request.put(`/api/data/stories/${original.id}?scope=${scope}`, { data: { ...original,
        characterCustomizations: original.characterCustomizations!.map((entry) => entry.characterId === lia.id ? { ...entry, name: 'Lía' } : entry) } })
      await expect(response).toBeOK()
      const story = await response.json() as Story
      const earlier = await data.createMessage({ story, scope, role: 'assistant', raw: 'Lía: Texto antiguo.',
        segments: [{ type: 'dialogue', characterId: lia.id, tag: null, text: 'Texto antiguo.' }] })
      const systems: string[] = []
      await page.route('**/api/llm/chat', async route => {
        systems.push(route.request().postDataJSON().messages[0].content)
        await route.fulfill({ json: { content: systems.length === 1
          ? 'Antes del regreso.\n' + (kind === 'thought' ? 'Pensamiento ' : '') + 'Lia [aspecto-lia]: Estoy aquí.\nBruno sigue lejos.'
          : 'Esperamos a Bruno.', finishReason: 'stop' } })
      })
      if (scope === 'private') {
        await page.goto('/')
        await page.locator('main').press('Control+Alt+p')
        await expect(page.locator('html')).toHaveClass(/private-scope/)
        await page.locator(`a[href="/stories/${story.id}"]`).first().click()
      } else await page.goto('/stories/' + story.id)
      await page.getByRole('textbox', { name: 'Tu intervención', exact: true }).fill('Continúa.')
      await page.getByRole('button', { name: 'Enviar', exact: true }).click()
      await expect.poll(async () => (await data.get<Story>('stories', story.id, scope)).absentCharacterIds).toEqual([bruno.id])
      await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible()
      const returned = (await data.list<Message>('messages', scope, { storyId: story.id })).at(-1)!
      expect(returned.absentCharacterIds).toEqual([lia.id, bruno.id])
      expect(returned.segments[1]).toMatchObject({ type: kind, characterId: lia.id, imageId: image.id, returnsToScene: true })
      expect((await data.get<Message>('messages', earlier.id, scope)).segments[0]?.returnsToScene).toBeUndefined()
      expect(systems[0]).toContain('Lía no debe hablar, dialogar, pensar ni actuar en esta respuesta')
      expect(systems[0]).toContain('Bruno no debe hablar, dialogar, pensar ni actuar en esta respuesta')
      expect(systems[0]).not.toContain('aspecto-lia')
      expect(systems[0]).not.toContain('aspecto-bruno')
      expect(systems[0]).not.toContain(soundTag)
      if (kind === 'dialogue') await page.getByTestId('visual-mode-toggle').click()
      if (await page.getByTestId('story-end-button').isEnabled()) await page.getByTestId('story-end-button').click()
      const sprite = page.getByTestId('visual-novel-cast').locator('[data-character-id="' + lia.id + '"]')
      await expect(sprite.locator('img')).toBeVisible()
      await page.getByTestId('visual-novel-previous').click()
      await expect(page.getByTestId('visual-novel-frame')).toContainText('Estoy aquí.')
      await expect(sprite.locator('img')).toBeVisible()
      await page.getByTestId('visual-novel-previous').click()
      await expect(page.getByTestId('visual-novel-frame')).toContainText('Antes del regreso.')
      await expect(sprite).toHaveCount(0)
      await page.getByTestId('visual-novel-previous').click()
      await page.getByTestId('visual-novel-previous').click()
      await expect(page.getByTestId('visual-novel-frame')).toContainText('Texto antiguo.')
      await expect(sprite).toHaveCount(0)
      await page.getByTestId('story-end-button').click()
      await page.reload()
      if (scope === 'private') {
        await page.goto('/')
        await page.locator('main').press('Control+Alt+p')
        await expect(page.locator('html')).toHaveClass(/private-scope/)
        await page.locator(`a[href="/stories/${story.id}"]`).first().click()
      }
      await expect(sprite.locator('img')).toBeVisible()
      for (const width of [320, 390, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        await expect(sprite.locator('img')).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        if (scope === 'normal' && kind === 'thought' && width === 390) {
          await page.getByTestId('visual-novel-previous').click()
          await expect(page.getByTestId('visual-novel-frame')).toContainText('Estoy aquí.')
          await page.screenshot({ path: resolve('.data/issue-259-novela-390.png') })
          await page.getByTestId('visual-novel-next').click()
        }
      }
      await page.getByTestId('visual-mode-toggle').click()
      await expect(page.getByTestId('chat-scene-stage').getByRole('switch', { name: 'Presencia de Lía' })).toHaveAttribute('aria-checked', 'true')
      await expect(page.getByTestId('chat-scene-stage').getByRole('switch', { name: 'Presencia de Bruno' })).toHaveAttribute('aria-checked', 'false')
      if (scope === 'normal' && kind === 'dialogue') await page.screenshot({ path: resolve('.data/issue-259-chat.png') })
      await page.getByRole('textbox', { name: 'Tu intervención', exact: true }).fill('Seguimos.')
      await page.getByRole('button', { name: 'Enviar', exact: true }).click()
      await expect.poll(() => systems.length).toBe(2)
      expect(systems[1]).toContain('aspecto-lia')
      expect(systems[1]).not.toContain('aspecto-bruno')
      await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible()
    })
  }
}

for (const mode of ['opening', 'continue', 'auto', 'regenerate'] as const) {
  test(`retorno en ${mode} y respuesta parcial por tokens`, async ({ page, data }) => {
    const character = await data.createCharacter({ name: 'Bruno' })
    await data.createImage(character)
    const story = await data.createStory({ characters: [character], absentCharacterIds: [character.id] })
    const earlier = mode === 'opening' ? null : await data.createMessage({ story, role: 'assistant', raw: 'Esperamos.',
      segments: [{ type: 'narration', text: 'Esperamos.' }] })
    const systems: string[] = []
    await page.route('**/api/llm/chat', route => {
      systems.push(route.request().postDataJSON().messages[0].content)
      return route.fulfill({ json: { content: 'Bruno: Regreso.', finishReason: 'length' } })
    })
    await page.goto('/stories/' + story.id)
    if (mode === 'opening') await page.getByRole('button', { name: 'Deja que la história empiece sola' }).first().click()
    else if (mode === 'regenerate') {
      const bubble = page.locator('[data-story-message-id="' + earlier!.id + '"]')
      await bubble.hover()
      await bubble.getByRole('button', { name: 'Regenerar desde este mensaje', exact: true }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Regenerar', exact: true }).click()
    } else await page.getByTestId(mode === 'auto' ? 'auto-button' : 'continue-button').click()
    await expect.poll(async () => (await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([])
    await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible()
    const returned = (await data.list<Message>('messages', 'normal', { storyId: story.id })).at(-1)!
    expect(returned.segments[0]?.returnsToScene).toBe(true)
    expect(returned.absentCharacterIds).toEqual([character.id])
    if (mode === 'auto') {
      const bubble = page.locator('[data-story-message-id="' + returned.id + '"]')
      await bubble.hover()
      await bubble.getByRole('button', { name: 'Regenerar desde este mensaje', exact: true }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Regenerar', exact: true }).click()
      await expect.poll(() => systems.length).toBe(2)
      expect(systems[1]).toContain('Puedes hablar y decidir por el protagonista')
      await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible()
      expect((await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([])
    }
  })
}

test('fallo sin guardar no reincorpora; Stop con texto mostrado sí', async ({ page, data }) => {
  const character = await data.createCharacter({ name: 'Bruno' })
  const story = await data.createStory({ characters: [character], absentCharacterIds: [character.id] })
  let fail = true
  await page.route('**/api/llm/chat', route => route.fulfill(fail
    ? { status: 502, json: { message: 'Fallo de prueba' } }
    : { json: { content: 'Bruno: ' + 'Regreso lentamente. '.repeat(150), finishReason: 'stop' } }))
  await page.goto('/stories/' + story.id)
  const composer = page.getByRole('textbox', { name: 'Tu intervención', exact: true })
  await composer.fill('Continúa.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible()
  expect((await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([character.id])
  fail = false
  await data.patchSettings({ responseSpeed: 'slow' })
  await page.reload()
  await composer.fill('Continúa otra vez.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByTestId('story-scroller')).toContainText('Regreso lentamente.')
  expect((await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([character.id])
  await page.getByRole('button', { name: 'Parar', exact: true }).first().click()
  await expect.poll(async () => (await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([])
  const saved = (await data.list<Message>('messages', 'normal', { storyId: story.id })).at(-1)!
  expect(saved.raw.length).toBeLessThan(1000)
  expect(saved.segments[0]?.returnsToScene).toBe(true)
})

test('Parar esperando respuesta no guarda retorno ni mensaje del narrador', async ({ page, data }) => {
  const character = await data.createCharacter({ name: 'Bruno' })
  const story = await data.createStory({ characters: [character], absentCharacterIds: [character.id] })
  const gate = Promise.withResolvers<undefined>()
  let requested = false
  await page.route('**/api/llm/chat', async route => {
    requested = true
    await gate.promise
    await route.fulfill({ json: { content: 'Bruno: Regreso.', finishReason: 'stop' } }).catch(() => {})
  })
  await page.goto('/stories/' + story.id)
  await page.getByRole('textbox', { name: 'Tu intervención', exact: true }).fill('Continúa.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect.poll(() => requested).toBe(true)
  await page.getByRole('button', { name: 'Parar', exact: true }).first().click()
  gate.resolve(undefined)
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible()
  expect((await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([character.id])
  expect((await data.list<Message>('messages', 'normal', { storyId: story.id })).map(message => message.role)).toEqual(['user'])
})

test('fallo al guardar respuesta no deja personaje presente sin respuesta guardada', async ({ page, data }) => {
  const character = await data.createCharacter({ name: 'Bruno' })
  const story = await data.createStory({ characters: [character], absentCharacterIds: [character.id] })
  await page.route('**/api/llm/chat', route => route.fulfill({ json: { content: 'Bruno: Regreso.', finishReason: 'stop' } }))
  await page.route('**/api/data/messages/*?generated=1&scope=normal', route => route.fulfill({ status: 500, json: { message: 'No se pudieron guardar los datos' } }))
  await page.goto('/stories/' + story.id)
  await page.getByRole('textbox', { name: 'Tu intervención', exact: true }).fill('Continúa.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByRole('alert').first()).toContainText('500')
  expect((await data.get<Story>('stories', story.id)).absentCharacterIds).toEqual([character.id])
  expect((await data.list<Message>('messages', 'normal', { storyId: story.id })).map(message => message.role)).toEqual(['user'])
})
