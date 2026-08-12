import type { Message, Story } from '../../shared/types'
import { expect, test, type TestDataFactory } from './fixtures'

async function createStoryFixture(data: TestDataFactory, visualMode = false) {
  const character = await data.createCharacter()
  const image = await data.createImage(character, ['feliz', 'armadura'])
  const background = await data.createBackground()
  const preset = await data.createPreset()
  const story = await data.createStory({
    characters: [character],
    background,
    preset,
    visualMode
  })
  return { character, image, background, preset, story }
}

test.describe('historias', () => {
  test('crea historia con configuración propia y la edita', async ({ page, data }) => {
    const character = await data.createCharacter()
    const background = await data.createBackground()
    const preset = await data.createPreset()
    const title = data.unique('Historia-UI')
    const premise = data.unique('Planteamiento')
    const storyPrompt = data.unique('Prompt-historia')
    const storyTag = data.unique('etiqueta-historia')

    await page.goto('/stories/new')
    await page.getByLabel('Título').fill(title)
    await page.getByLabel('Planteamiento').fill(premise)
    await page.getByLabel('Preferencias del protagonista').fill('Ser prudente.')
    await page.getByLabel('Combinar con globales').selectOption('replace')
    await page.getByRole('button', { name: new RegExp(character.name) }).click()
    await page.locator(`#story-character-prompt-${character.id}`).fill(storyPrompt)
    await page.locator(`#story-character-tags-${character.id}`).fill(storyTag)
    await page.locator(`#story-character-tags-${character.id}`).press('Enter')
    await page.getByRole('button', { name: new RegExp(background.tags[0]!) }).click()
    await page.getByLabel('Prompt de preparación').selectOption(preset.id)
    await page.getByRole('button', { name: 'Empezar historia' }).click()

    await expect(page).toHaveURL(/\/stories\/[^/]+$/)
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    const storyId = new URL(page.url()).pathname.split('/').pop()!
    const stored = await data.get<Story>('stories', storyId)
    expect(stored).toMatchObject({
      title,
      premise,
      protagonistPreferences: 'Ser prudente.',
      protagonistPreferencesMode: 'replace',
      characterIds: [character.id],
      initialBackgroundId: background.id,
      presetId: preset.id
    })
    expect(stored.characterCustomizations[0]?.prompt).toBe(storyPrompt)
    expect(stored.characterCustomizations[0]?.tags).toContain(storyTag)

    const updatedPremise = data.unique('Planteamiento-editado')
    await page.getByRole('button', { name: 'Ajustes de la historia' }).click()
    const form = page.getByRole('heading', { name: 'Ajustes de la historia' }).locator('..')
    await form.getByLabel('Planteamiento').fill(updatedPremise)
    await form.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByText(updatedPremise)).toBeVisible()
    await expect.poll(async () => (await data.get<Story>('stories', storyId)).premise)
      .toBe(updatedPremise)
  })

  test('copia planteamiento sin título ni mensajes y mantiene independencia', async ({ page, data }) => {
    const { story } = await createStoryFixture(data, true)
    await data.createMessage({ story, role: 'user', raw: 'Mensaje que no debe copiarse.' })
    const copiedTitle = data.unique('Historia-copiada')

    await page.goto(`/stories/new?copyFrom=${story.id}`)
    await expect(page.getByLabel('Título')).toHaveValue('')
    await expect(page.getByLabel('Planteamiento')).toHaveValue(story.premise)
    await page.getByLabel('Título').fill(copiedTitle)
    await page.getByRole('button', { name: 'Empezar historia' }).click()

    await expect(page.getByRole('heading', { name: copiedTitle })).toBeVisible()
    const copiedId = new URL(page.url()).pathname.split('/').pop()!
    const copied = await data.get<Story>('stories', copiedId)
    expect(copied.id).not.toBe(story.id)
    expect(copied).toMatchObject({
      title: copiedTitle,
      premise: story.premise,
      visualMode: true,
      characterIds: story.characterIds
    })
    expect(await data.list<Message>('messages', 'normal', { storyId: copiedId })).toHaveLength(0)

    await page.getByRole('button', { name: 'Ajustes de la historia' }).click()
    const form = page.getByRole('heading', { name: 'Ajustes de la historia' }).locator('..')
    await form.getByLabel('Planteamiento').fill('Copia independiente.')
    await form.getByRole('button', { name: 'Guardar' }).click()
    expect((await data.get<Story>('stories', story.id)).premise).toBe(story.premise)
  })

  test('cancela y confirma borrado de historia', async ({ page, data }) => {
    const { story } = await createStoryFixture(data)
    await page.goto('/')
    const card = page.locator('li').filter({ hasText: story.title })

    await card.getByRole('button', { name: 'Borrar' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar' }).click()
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Borrar' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Borrar' }).click()
    await expect(card).toHaveCount(0)
  })
})

test.describe('chat', () => {
  test('envía, edita, reenvía, regenera y borra mensajes', async ({ page, data }) => {
    const { story } = await createStoryFixture(data)
    await data.patchSettings({ mockMode: true, responseSpeed: 'instant', userName: 'Vera' })
    const input = data.unique('Primer-movimiento')

    await page.goto(`/stories/${story.id}`)
    await page.getByPlaceholder('Escribe lo que haces o dices…').fill(input)
    await page.getByRole('button', { name: 'Enviar' }).click()
    await expect(page.getByText(input, { exact: true })).toBeVisible()
    await expect.poll(async () => (await data.list<Message>('messages', 'normal', {
      storyId: story.id
    })).length).toBe(2)

    let messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(messages[1]?.role).toBe('assistant')
    const edited = data.unique('Mensaje-editado')
    await page.getByRole('button', { name: 'Editar mensaje' }).first().click()
    const editForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Cancelar' })
    })
    await editForm.locator('textarea').fill(edited)
    await editForm.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByText(edited, { exact: true })).toBeVisible()

    const firstAssistantId = messages[1]!.id
    await page.getByRole('button', { name: 'Reenviar este mensaje' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reenviar' }).click()
    await expect.poll(async () => {
      const next = await data.list<Message>('messages', 'normal', { storyId: story.id })
      return next.find((message) => message.role === 'assistant')?.id ?? firstAssistantId
    }).not.toBe(firstAssistantId)

    messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
    const secondAssistantId = messages.find((message) => message.role === 'assistant')!.id
    await page.getByRole('button', { name: 'Regenerar desde este mensaje' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Regenerar' }).click()
    await expect.poll(async () => {
      const next = await data.list<Message>('messages', 'normal', { storyId: story.id })
      return next.find((message) => message.role === 'assistant')?.id ?? secondAssistantId
    }).not.toBe(secondAssistantId)

    await page.getByRole('button', { name: 'Borrar mensaje' }).last().click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Borrar' }).click()
    await expect.poll(async () => (await data.list<Message>('messages', 'normal', {
      storyId: story.id
    })).length).toBe(1)
  })

  test('Sigue continúa sin decidir por protagonista', async ({ page, data }) => {
    const { story } = await createStoryFixture(data)
    await data.patchSettings({ mockMode: true, responseSpeed: 'instant', userName: 'Vera' })

    await page.goto(`/stories/${story.id}`)
    await page.getByTestId('continue-button').click()

    await expect.poll(async () => (await data.list<Message>('messages', 'normal', {
      storyId: story.id
    })).length).toBe(1)
    const response = (await data.list<Message>('messages', 'normal', { storyId: story.id }))[0]!
    expect(response.raw).not.toContain('Vera: Decido seguir adelante.')
  })

  test('Parar en Auto conserva el pintado y la respuesta completa', async ({ page, data }) => {
    const { story } = await createStoryFixture(data)
    await data.patchSettings({ mockMode: true, responseSpeed: 'medium', userName: 'Vera' })

    await page.goto(`/stories/${story.id}`)
    await page.getByTestId('auto-button').click()
    const stop = page.getByRole('button', { name: 'Parar', exact: true })
    await expect(stop).toBeVisible()
    await expect.poll(async () => (await page.getByTestId('story-scroller').innerText()).length)
      .toBeGreaterThan(20)
    const lengthAtStop = (await page.getByTestId('story-scroller').innerText()).length
    await stop.click()
    await expect.poll(async () => (await page.getByTestId('story-scroller').innerText()).length, {
      timeout: 10_000
    }).toBeGreaterThan(lengthAtStop)
    await expect(stop).toBeHidden({ timeout: 10_000 })

    const messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe('assistant')
    expect(messages[0]?.raw).toContain('Vera: Decido seguir adelante.')
  })
})

test.describe('novela visual y responsive', () => {
  test('persiste modo visual, fondo y avance manual', async ({ page, data }) => {
    const { story, character, image, background } = await createStoryFixture(data)
    await data.patchSettings({ visualNovelManualAdvance: false })
    await data.createMessage({ story, role: 'user', raw: 'Entro en el bosque.' })
    await data.createMessage({
      story,
      role: 'assistant',
      raw: 'Fondo. Narración. Diálogo.',
      segments: [
        { type: 'background', characterId: null, backgroundId: background.id, tag: background.tags[0]!, text: '' },
        { type: 'narration', characterId: null, tag: null, text: 'Las ramas crujen.' },
        {
          type: 'dialogue',
          characterId: character.id,
          tag: 'feliz',
          tags: ['feliz', 'armadura'],
          imageId: image.id,
          text: 'Te estaba esperando.'
        }
      ]
    })

    await page.goto(`/stories/${story.id}`)
    await page.getByTestId('visual-mode-toggle').click()
    await expect(page.getByTestId('visual-novel-view')).toBeVisible()
    await expect(page.getByTestId('visual-novel-background')).toBeVisible()
    await expect(page.getByTestId('visual-novel-frame')).toContainText('Te estaba esperando.')
    await expect(page.getByTestId('visual-novel-counter')).toHaveText('3 / 3')
    await page.getByTestId('visual-manual-advance-toggle').click()
    await page.getByTestId('visual-novel-previous').click()
    await expect(page.getByTestId('visual-novel-frame')).toContainText('Las ramas crujen.')

    expect((await data.get<Story>('stories', story.id)).visualMode).toBe(true)
    const settingsResponse = await page.request.get('/api/settings')
    expect((await settingsResponse.json()).visualNovelManualAdvance).toBe(true)
  })

  for (const width of [320, 390]) {
    test(`menú móvil y editor sin overflow a ${width}px`, async ({ page, data }) => {
      const { story } = await createStoryFixture(data)
      await page.setViewportSize({ width, height: 760 })
      await page.goto(`/stories/${story.id}`)

      const toggle = page.getByTestId('mobile-story-menu-toggle')
      await expect(toggle).toBeVisible()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await expect(page.locator('#app-navigation')).toBeVisible()
      await expect(page.locator('#story-header')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true)
    })
  }
})
