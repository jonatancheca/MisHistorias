import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import type {
  CharacterImage,
  LlmDebugTrace,
  Message,
  Story,
  StorySaveSlot
} from '../../shared/types'
import { expect, PNG_BYTES, test, type TestDataFactory } from './fixtures'

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

async function prepareVisualResponse(
  page: Page,
  data: TestDataFactory,
  content: string,
  manualAdvance = true
) {
  await data.patchSettings({
    mockMode: false,
    model: 'test-model',
    useChromeLlm: false,
    privateUseChromeLlm: null,
    responseSpeed: 'slow',
    visualNovelManualAdvance: manualAdvance,
    userName: 'Vera',
    historyBudget: 100_000
  })
  const responseReady = Promise.withResolvers<undefined>()
  const responseRequested = Promise.withResolvers<undefined>()
  await page.route('**/api/llm/chat', async (route) => {
    responseRequested.resolve(undefined)
    await responseReady.promise
    await route.fulfill({ json: { content, finishReason: 'stop' } })
  })
  await page.clock.install()
  return {
    requested: responseRequested.promise,
    release: () => responseReady.resolve(undefined)
  }
}

async function pauseVisualClock(page: Page) {
  await page.clock.pauseAt(new Date(Date.now() + 60_000))
}

async function focusVisualKeyboard(page: Page) {
  // Los atajos globales excluyen controles interactivos: no pulsar el botón
  // que conserve el foco tras iniciar la generación.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await expect(page.locator('body')).toBeFocused()
}

test.describe('historias', () => {
  test('crea historia con configuración propia y la edita', async ({ page, data }) => {
    const character = await data.createCharacter()
    const background = await data.createBackground()
    const title = data.unique('Historia-UI')
    const premise = data.unique('Planteamiento')
    const storyPrompt = data.unique('Prompt-historia')
    const storyTag = data.unique('etiqueta-historia')
    const storyCharacterName = data.unique('Nombre-historia')
    const storyCharacterColor = '#6366f1'

    await page.goto('/stories/new')
    await page.getByLabel('Título').fill(title)
    await page.getByLabel('Planteamiento').fill(premise)
    await page.getByLabel('Preferencias del protagonista').fill('Ser prudente.')
    await page.getByLabel('Combinar con globales').selectOption('replace')
    await page.getByRole('button', { name: new RegExp(character.name) }).click()
    await page.locator(`#story-character-name-${character.id}`).fill(storyCharacterName)
    await page.locator(`#story-character-prompt-${character.id}`).fill(storyPrompt)
    await page.locator(`#story-character-tags-${character.id}`).fill(storyTag)
    await page.locator(`#story-character-tags-${character.id}`).press('Enter')
    await page.getByRole('button', { name: new RegExp(background.tags[0]!) }).click()
    await page.getByRole('checkbox', { name: 'Crear imágenes nuevas durante la historia' }).check()
    await page.getByRole('button', { name: 'Empezar historia' }).click()

    await expect(page).toHaveURL(/\/stories\/[^/]+$/)
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await expect(page.getByTestId('chat-scene-stage').getByText(storyCharacterName, { exact: true }))
      .toBeVisible()
    const storyId = new URL(page.url()).pathname.split('/').pop()!
    const stored = await data.get<Story>('stories', storyId)
    expect(stored).toMatchObject({
      title,
      premise,
      protagonistPreferences: 'Ser prudente.',
      protagonistPreferencesMode: 'replace',
      characterIds: [character.id],
      initialBackgroundId: background.id,
      autoGenerateImages: true
    })
    expect(stored.characterCustomizations[0]?.prompt).toBe(storyPrompt)
    expect(stored.characterCustomizations[0]?.name).toBe(storyCharacterName)
    expect(stored.characterCustomizations[0]?.color).toBe(character.color)
    expect(stored.characterCustomizations[0]?.tags).toContain(storyTag)

    const updatedPremise = data.unique('Planteamiento-editado')
    const updatedTitle = data.unique('Historia-editada')
    const updatedCharacterName = data.unique('Nombre-editado')
    await page.getByRole('button', { name: 'Ajustes de la historia' }).click()
    const form = page.getByRole('heading', { name: 'Ajustes de la historia' }).locator('..')
    await expect(form.getByRole('heading', {
      name: `${character.name} → ${storyCharacterName}`
    })).toBeVisible()
    await form.getByLabel('Título').fill(updatedTitle)
    await form.getByLabel('Planteamiento').fill(updatedPremise)
    await form.getByRole('checkbox', { name: 'Crear imágenes nuevas durante la historia' }).uncheck()
    await form.locator(`#story-settings-character-name-${character.id}`).fill(updatedCharacterName)
    await form.locator(`#story-settings-character-color-${character.id}`).fill(storyCharacterColor)
    await expect(form.getByRole('heading', {
      name: `${character.name} → ${updatedCharacterName}`
    })).toBeVisible()
    await form.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByRole('heading', { name: updatedTitle })).toBeVisible()
    await expect(page.getByText(updatedPremise)).toBeVisible()
    await expect.poll(async () => await data.get<Story>('stories', storyId)).toMatchObject({
      title: updatedTitle,
      premise: updatedPremise,
      autoGenerateImages: false,
      characterCustomizations: [{
        characterId: character.id,
        name: updatedCharacterName,
        color: storyCharacterColor
      }]
    })

    const dialogue = data.unique('Diálogo-con-color')
    await data.createMessage({
      story: await data.get<Story>('stories', storyId),
      role: 'assistant',
      raw: dialogue,
      segments: [{
        type: 'dialogue',
        characterId: character.id,
        tag: null,
        text: dialogue
      }]
    })
    await page.reload()
    await expect(page.getByText(dialogue, { exact: true })).toHaveCSS('color', 'rgb(99, 102, 241)')
    await page.getByTestId('visual-mode-toggle').click()
    await expect(page.getByTestId('visual-novel-frame').getByText(dialogue, { exact: true }))
      .toBeVisible()
    await expect(page.getByTestId('visual-novel-frame').locator('p')).toHaveCSS(
      'color',
      'rgb(99, 102, 241)'
    )
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

  test('añade personajes desde ajustes y conserva su copia independiente', async ({ page, data }) => {
    const { story, character } = await createStoryFixture(data)
    const added = await data.createCharacter({
      name: data.unique('Personaje-añadido'),
      prompt: data.unique('Prompt-añadido'),
      tags: [data.unique('rasgo-añadido')]
    })

    await page.goto(`/stories/${story.id}`)
    await page.getByRole('button', { name: 'Ajustes de la historia' }).click()
    const form = page.getByRole('heading', { name: 'Ajustes de la historia' }).locator('..')
    await form.getByRole('button', { name: `Añadir ${added.name}` }).click()
    await expect(form.locator(`#story-settings-character-prompt-${added.id}`)).toHaveValue(
      added.prompt
    )
    await form.getByRole('button', { name: 'Guardar' }).click()

    await expect.poll(async () => await data.get<Story>('stories', story.id)).toMatchObject({
      characterIds: [character.id, added.id],
      characterCustomizations: [
        { characterId: character.id, prompt: character.prompt, tags: character.tags },
        { characterId: added.id, prompt: added.prompt, tags: added.tags }
      ]
    })

    await page.reload()
    await page.getByRole('button', { name: 'Ajustes de la historia' }).click()
    await expect(page.getByRole('heading', { name: added.name })).toBeVisible()
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

  test('guarda, carga, bifurca, borra y exporta partidas', async ({ page, data }) => {
    const { story } = await createStoryFixture(data)
    const original = await data.createMessage({
      story,
      role: 'assistant',
      raw: 'Narración: Progreso original guardado.'
    })
    const trace: LlmDebugTrace = {
      id: data.unique('trace'),
      storyId: story.id,
      responseMessageId: original.id,
      status: 'success',
      request: {
        model: 'modelo-prueba',
        messages: [{ role: 'user', content: 'Continúa.' }],
        temperature: 0.8,
        max_tokens: 500,
        stream: false
      },
      response: { content: original.raw, finishReason: null },
      createdAt: Date.now()
    }
    const traceResponse = await page.request.put(
      `/api/data/llmDebugTraces/${trace.id}?scope=normal`,
      { data: trace }
    )
    await expect(traceResponse).toBeOK()

    await page.goto(`/stories/${story.id}`)
    await page.getByRole('button', { name: 'Partidas' }).click()
    const dialog = page.getByRole('dialog', { name: 'Partidas' })
    const name = dialog.getByLabel('Nombre de la partida')
    await expect(name).not.toHaveValue('')
    await name.fill('Mismo nombre')
    await dialog.getByRole('button', { name: 'Guardar partida' }).click()
    await expect(dialog.getByRole('listitem')).toHaveCount(1)
    await dialog.getByRole('button', { name: 'Guardar partida' }).click()
    await expect(dialog.getByRole('listitem')).toHaveCount(2)

    const saved = await data.list<StorySaveSlot>('storySaves', 'normal', { storyId: story.id })
    expect(saved).toHaveLength(2)
    expect(saved[0]?.name).toBe('Mismo nombre')
    expect(saved[0]?.thumbnailDataUrl).toMatch(/^data:image\/webp;base64,/)
    expect(saved[0]?.messages.map((message) => message.id)).toEqual([original.id])
    expect(saved[0]?.debugTraces.map((item) => item.id)).toEqual([trace.id])
    expect(saved[0]?.story).toMatchObject({ id: story.id, title: story.title })

    await dialog.getByRole('button', { name: 'Cerrar partidas' }).click()
    const branch = await data.createMessage({
      story,
      role: 'user',
      raw: 'Progreso posterior que se reemplazará.'
    })
    const changedStory = { ...story, title: data.unique('Título-cambiado'), updatedAt: Date.now() }
    const changedResponse = await page.request.put(
      `/api/data/stories/${story.id}?scope=normal`,
      { data: changedStory }
    )
    await expect(changedResponse).toBeOK()
    await page.reload()
    await expect(page.getByText(branch.raw, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Partidas' }).click()
    await dialog.getByRole('listitem').first().getByRole('button', { name: 'Cargar' }).click()
    const loadConfirm = page.getByRole('alertdialog', { name: 'Cargar partida' })
    await loadConfirm.getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.getByRole('heading', { name: changedStory.title })).toBeVisible()
    await dialog.getByRole('listitem').first().getByRole('button', { name: 'Cargar' }).click()
    await page.getByRole('alertdialog', { name: 'Cargar partida' })
      .getByRole('button', { name: 'Cargar' }).click()
    await expect(page.getByRole('heading', { name: story.title })).toBeVisible()
    await expect(page.getByText(branch.raw, { exact: true })).toHaveCount(0)
    expect(await data.list<Message>('messages', 'normal', { storyId: story.id }))
      .toHaveLength(1)
    expect(await data.list<StorySaveSlot>('storySaves', 'normal', { storyId: story.id }))
      .toHaveLength(2)

    const continuation = await data.createMessage({
      story,
      role: 'user',
      raw: 'Nueva rama después de cargar.'
    })
    await page.reload()
    await expect(page.getByText(continuation.raw, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Partidas' }).click()
    await page.setViewportSize({ width: 320, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
    await dialog.getByRole('listitem').first().getByRole('button', { name: 'Borrar' }).click()
    await page.getByRole('alertdialog', { name: 'Borrar partida' })
      .getByRole('button', { name: 'Cancelar' }).click()
    await expect(dialog.getByRole('listitem')).toHaveCount(2)
    await dialog.getByRole('listitem').first().getByRole('button', { name: 'Borrar' }).click()
    await page.getByRole('alertdialog', { name: 'Borrar partida' })
      .getByRole('button', { name: 'Borrar' }).click()
    await expect(dialog.getByRole('listitem')).toHaveCount(1)
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

    await dialog.getByRole('button', { name: 'Cerrar partidas' }).click()
    await page.goto('/settings')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exportar JSON' }).click()
    const download = await downloadPromise
    const exportPath = await download.path()
    expect(exportPath).not.toBeNull()
    const bundle = JSON.parse(readFileSync(exportPath!, 'utf8')) as {
      version: number
      stories: Array<{ title: string; saves?: StorySaveSlot[] }>
    }
    expect(bundle.version).toBe(21)
    expect(bundle.stories.find((item) => item.title === story.title)?.saves).toHaveLength(1)
  })

  test('cierra diálogos con Escape aunque el disparador conserve el foco', async ({ page, data }) => {
    const { story } = await createStoryFixture(data)
    await page.goto(`/stories/${story.id}`)

    await page.getByRole('button', { name: 'Partidas', exact: true }).click()
    const saves = page.getByRole('dialog', { name: 'Partidas' })
    await expect(saves).toBeVisible()
    await page.getByRole('button', { name: 'Partidas', exact: true }).press('Escape')
    await expect(saves).toHaveCount(0)

    await page.getByRole('button', { name: 'Ajustes de la historia', exact: true }).click()
    const preferences = page.getByRole('heading', { name: 'Ajustes de la historia' })
    await expect(preferences).toBeVisible()
    await page.getByRole('button', { name: 'Ajustes de la historia', exact: true }).press('Escape')
    await expect(preferences).toHaveCount(0)
  })
})

test.describe('chat', () => {
  for (const visualMode of [false, true]) {
    test(`muestra pensando sobre escritura en ${visualMode ? 'Visual Novel' : 'chat'}`, async ({ page, data }) => {
      const { story } = await createStoryFixture(data, visualMode)
      await data.patchSettings({ mockMode: false, model: 'test-model', useChromeLlm: false, privateUseChromeLlm: null, responseSpeed: 'instant' })
      let releaseResponse!: () => void
      const responseReady = new Promise<void>((resolve) => { releaseResponse = resolve })
      await page.route('**/api/llm/chat', async (route) => {
        await responseReady
        await route.fulfill({ json: { content: 'La espera termina.', finishReason: 'stop' } })
      })
      await page.goto(`/stories/${story.id}`)
      await page.getByPlaceholder('Escribe lo que haces o dices…').fill('Comienza.')
      await page.getByRole('button', { name: 'Enviar', exact: true }).click()
      const indicator = page.getByTestId('thinking-indicator')
      try {
        if (visualMode) {
          await expect(page.getByTestId('visual-message-actions').getByRole('button', { name: 'Editar mensaje' })).toHaveCount(0)
          await expect(page.getByTestId('visual-message-actions').getByRole('button', { name: 'Borrar mensaje' })).toHaveCount(0)
        }
        for (const width of [1280, 320, 390]) {
          await page.setViewportSize({ width, height: 900 })
          await expect(indicator).toBeVisible()
          await expect(indicator).toHaveText('Creando historia…')
          await expect(page.locator('footer').getByTestId('thinking-indicator')).toHaveCount(1)
          const statusBounds = await indicator.boundingBox()
          const inputBounds = await page.getByPlaceholder('Escribe lo que haces o dices…').boundingBox()
          expect(statusBounds!.y + statusBounds!.height).toBeLessThanOrEqual(inputBounds!.y)
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        }
      } finally {
        releaseResponse()
      }
      await expect(indicator).toHaveCount(0)
    })
  }

  test('PageUp y PageDown navegan mensajes desde el cuadro de escritura', async ({ page, data }) => {
    const { story } = await createStoryFixture(data)
    const messages = []
    for (const label of ['Primero', 'Segundo', 'Tercero', 'Cuarto']) {
      messages.push(await data.createMessage({
        story,
        role: 'user',
        raw: `${label}: ${'contenido largo '.repeat(90)}`
      }))
    }

    await page.goto(`/stories/${story.id}`)
    const scroller = page.getByTestId('story-scroller')
    await scroller.evaluate((element) => element.scrollTo({ top: 0 }))
    const input = page.getByPlaceholder('Escribe lo que haces o dices…')
    await input.fill('Texto sin enviar')

    const alignedMessage = () => page.evaluate(() => {
      const container = document.querySelector<HTMLElement>('[data-testid="story-scroller"]')
      if (!container) return null
      const top = container.getBoundingClientRect().top
      const messages = Array.from(
        container.querySelectorAll<HTMLElement>('[data-story-message-id]')
      )
      return messages.toSorted((left, right) =>
        Math.abs(left.getBoundingClientRect().top - top) -
        Math.abs(right.getBoundingClientRect().top - top)
      )[0]?.dataset.storyMessageId ?? null
    })

    await input.press('PageDown')
    await expect.poll(alignedMessage).toBe(messages[1]!.id)
    await input.press('PageDown')
    await expect.poll(alignedMessage).toBe(messages[2]!.id)
    await input.press('PageUp')
    await expect.poll(alignedMessage).toBe(messages[1]!.id)
    await expect(input).toHaveValue('Texto sin enviar')
  })

  test('envía un único system con catálogo completo para Qwen', async ({ page, data }) => {
    const { story, character, background } = await createStoryFixture(data)
    await data.createImage(character, ['feliz', 'armadura'])
    await data.createImage(character, ['feliz'])
    const sound = await data.createSound(character, [data.unique('campana')])
    await data.createMessage({ story, role: 'user', raw: 'IA: Habla en susurros.' })
    await data.patchSettings({
      mockMode: false,
      model: 'qwen-test',
      responseSpeed: 'instant',
      useChromeLlm: false,
      privateUseChromeLlm: null
    })
    let requestMessages: Array<{ role: string; content: string }> = []
    await page.route('**/api/llm/chat', async (route) => {
      requestMessages = route.request().postDataJSON().messages
      await route.fulfill({ json: { content: 'La escena continúa.', finishReason: 'stop' } })
    })

    await page.goto(`/stories/${story.id}`)
    await page.getByPlaceholder('Escribe lo que haces o dices…').fill('Entra en la sala.')
    await page.getByRole('button', { name: 'Enviar' }).click()
    await expect.poll(async () => (
      await data.list<Message>('messages', 'normal', { storyId: story.id })
    ).some((message) => message.role === 'assistant')).toBe(true)

    expect(requestMessages.filter((message) => message.role === 'system')).toHaveLength(1)
    const systemContent = requestMessages[0]?.content ?? ''
    expect(systemContent).toContain(character.name)
    expect(systemContent).toContain(character.prompt)
    expect(systemContent).toContain(character.tags.join(', '))
    expect(systemContent.match(/^ {2}- \[feliz\] \[armadura\]$/gm)).toHaveLength(1)
    expect(systemContent.match(/^ {2}- \[feliz\]$/gm)).toHaveLength(1)
    expect(systemContent).not.toContain(background.description)
    expect(systemContent).not.toContain('sin descripción')
    expect(systemContent).toContain(`[${sound.tags[0]}] (personaje ${character.name})`)
    expect(systemContent).toContain('Habla en susurros.')
    expect(requestMessages.slice(1).every((message) => message.role !== 'system')).toBe(true)
  })

  test('compacta historial, bloquea envíos y permite revisar su debug', async ({ page, data }) => {
    const { story } = await createStoryFixture(data)
    const firstAction = data.unique('Accion-que-sera-resumida')
    const nextAction = data.unique('Accion-posterior')
    const summary = 'La protagonista abrió la puerta y avanzó por el pasillo.'
    await data.patchSettings({
      mockMode: false,
      model: 'qwen-test',
      responseSpeed: 'instant',
      historyBudget: 100,
      useChromeLlm: false,
      privateUseChromeLlm: null
    })
    let releaseCompaction!: () => void
    const compactionGate = new Promise<void>((resolve) => {
      releaseCompaction = resolve
    })
    const chatRequests: Array<Array<{ role: string; content: string }>> = []
    let compactionRequest: Array<{ role: string; content: string }> = []
    await page.route('**/api/llm/chat', async (route) => {
      const request = route.request().postDataJSON() as {
        messages: Array<{ role: string; content: string }>
      }
      if (request.messages[0]?.content.includes('Resume el historial de esta historia')) {
        compactionRequest = request.messages
        await compactionGate
        await route.fulfill({ json: { content: summary, finishReason: 'stop' } })
        return
      }
      chatRequests.push(request.messages)
      await route.fulfill({
        json: { content: 'Narración: La historia avanza.', finishReason: 'stop' }
      })
    })

    await page.setViewportSize({ width: 320, height: 760 })
    await page.goto(`/stories/${story.id}`)
    const input = page.getByPlaceholder('Escribe lo que haces o dices…')
    await input.fill(firstAction)
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()

    await expect(page.getByText('Narración: La historia avanza.', { exact: true })).toBeVisible()
    await expect(page.getByTestId('compacting-indicator')).toContainText(
      'Compactando la historia'
    )
    await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeDisabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true)
    expect(JSON.stringify(compactionRequest)).toContain(firstAction)
    releaseCompaction()

    await expect(page.getByTestId('compacting-indicator')).toBeHidden()
    await expect.poll(async () => await data.get<Story>('stories', story.id)).toMatchObject({
      contextSummary: summary
    })
    const compactionTrace = (await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', {
      storyId: story.id
    })).find((trace) => trace.request.purpose === 'compaction')
    expect(compactionTrace?.response).toMatchObject({ content: summary })

    await page.getByRole('button', { name: 'Ver datos de debug de la compactación' }).click()
    const dialog = page.getByRole('dialog', { name: 'Debug compactación' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Resume el historial de esta historia', { exact: false }))
      .toBeVisible()
    await expect(dialog.getByTestId('llm-debug-response-json')).toContainText(summary)
    await dialog.getByRole('button', { name: 'Cerrar debug LLM' }).click()

    await data.patchSettings({ historyBudget: 1_000_000 })
    await page.setViewportSize({ width: 390, height: 760 })
    await page.reload()
    await page.getByPlaceholder('Escribe lo que haces o dices…').fill(nextAction)
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect.poll(() => chatRequests.length).toBe(2)
    const secondRequest = JSON.stringify(chatRequests[1])
    expect(secondRequest).toContain(summary)
    expect(secondRequest).toContain(nextAction)
    expect(secondRequest).not.toContain(firstAction)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true)
  })

  test('aplica Narrador solo hasta recibir la siguiente respuesta', async ({ page, data }) => {
    const { story, character } = await createStoryFixture(data)
    await data.patchSettings({
      mockMode: false,
      model: 'qwen-test',
      responseSpeed: 'instant',
      useChromeLlm: false,
      privateUseChromeLlm: null
    })
    const requests: Array<Array<{ role: string; content: string }>> = []
    await page.route('**/api/llm/chat', async (route) => {
      requests.push(route.request().postDataJSON().messages)
      await route.fulfill({
        json: {
          content: `${character.name} [feliz][armadura]: La escena continúa.`,
          finishReason: 'stop'
        }
      })
    })

    await page.goto(`/stories/${story.id}`)
    const input = page.getByPlaceholder('Escribe lo que haces o dices…')
    const instruction = 'Narrador: Habla en susurros.'
    await input.fill(instruction)
    await page.getByRole('button', { name: 'Enviar' }).click()
    await expect.poll(async () => (
      await data.list<Message>('messages', 'normal', { storyId: story.id })
    ).filter((message) => message.role === 'assistant').length).toBe(1)

    await input.fill('Entra en la sala.')
    await page.getByRole('button', { name: 'Enviar' }).click()
    await expect.poll(async () => (
      await data.list<Message>('messages', 'normal', { storyId: story.id })
    ).filter((message) => message.role === 'assistant').length).toBe(2)

    expect(requests).toHaveLength(2)
    expect(requests[0]?.filter((message) => message.role === 'system')).toHaveLength(1)
    expect(requests[0]?.[0]?.content).toContain('Habla en susurros.')
    expect(requests[1]?.filter((message) => message.role === 'system')).toHaveLength(1)
    expect(requests[1]?.[0]?.content).not.toContain('Habla en susurros.')
    await expect(page.getByText(instruction, { exact: true })).toHaveCount(0)
  })

  test('usa Chrome AI sin modelo LMStudio ni fallback', async ({ page, data }) => {
    const { story } = await createStoryFixture(data)
    const localResponse = 'Narración: respuesta local de Chrome.'
    await data.patchSettings({
      mockMode: false,
      model: '',
      responseSpeed: 'instant',
      useChromeLlm: true,
      privateUseChromeLlm: null
    })
    await page.addInitScript((response) => {
      type PromptMessage = { role: string; content: string }
      type ChromeWindow = Window & { __chromePromptRoles?: string[] }

      class FakeLanguageModel {
        static async availability() {
          return 'available'
        }

        static async create() {
          return new FakeLanguageModel()
        }

        async prompt(messages: PromptMessage[]) {
          ;(window as ChromeWindow).__chromePromptRoles = messages.map((message) => message.role)
          return response
        }

        destroy() {}
      }

      Object.defineProperty(globalThis, 'LanguageModel', {
        configurable: true,
        value: FakeLanguageModel
      })
    }, localResponse)

    await page.goto(`/stories/${story.id}`)
    await page.getByPlaceholder('Escribe lo que haces o dices…').fill('Continúa con Chrome.')
    await page.getByRole('button', { name: 'Enviar' }).click()

    await expect.poll(async () => {
      const messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
      return messages.find((message) => message.role === 'assistant')?.raw
    }).toBe(localResponse)

    const roles = await page.evaluate(() =>
      (window as Window & { __chromePromptRoles?: string[] }).__chromePromptRoles
    )
    expect(roles?.[0]).toBe('system')
    expect(roles?.slice(1)).not.toContain('system')

    const traces = await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', {
      storyId: story.id
    })
    expect(traces.at(-1)?.request).toMatchObject({
      provider: 'chrome',
      model: 'chrome-prompt-api'
    })

    await data.patchSettings({ useChromeLlm: false, privateUseChromeLlm: null })
  })

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

  test('muestra controles móviles y tags de imagen solicitados por el LLM', async ({ page, data }) => {
    const firstCharacter = await data.createCharacter({ name: data.unique('Alicia') })
    const secondCharacter = await data.createCharacter({ name: data.unique('Bruno') })
    const firstImage = await data.createImage(firstCharacter, ['feliz', 'armadura'])
    const secondImage = await data.createImage(secondCharacter, ['seria'])
    const story = await data.createStory({ characters: [firstCharacter, secondCharacter] })
    const userMessage = await data.createMessage({ story, role: 'user', raw: 'Miro la escena.' })
    const assistantMessage = await data.createMessage({
      story,
      role: 'assistant',
      raw: 'Respuesta con dos imágenes.',
      segments: [
        {
          type: 'dialogue',
          characterId: firstCharacter.id,
          tag: 'FELIZ',
          tags: ['FELIZ', 'ARMADURA'],
          imageId: firstImage.id,
          text: 'Primera intervención.'
        },
        {
          type: 'dialogue',
          characterId: secondCharacter.id,
          tag: 'seria',
          tags: ['seria', 'capa'],
          imageId: secondImage.id,
          text: 'Segunda intervención.'
        }
      ]
    })
    const trace: LlmDebugTrace = {
      id: data.unique('trace'),
      storyId: story.id,
      requestMessageId: userMessage.id,
      responseMessageId: assistantMessage.id,
      status: 'success',
      request: {
        provider: 'lmstudio',
        model: 'test-model',
        messages: [
          { role: 'system', content: 'Narra con claridad.' },
          { role: 'user', content: 'Miro la escena.' },
          { role: 'assistant', content: 'La escena permanece en silencio.' }
        ],
        temperature: 0.7,
        max_tokens: 100,
        stream: false
      },
      response: { content: assistantMessage.raw, finishReason: 'stop' },
      createdAt: Date.now()
    }
    const traceResponse = await page.request.put(`/api/data/llmDebugTraces/${trace.id}?scope=normal`, {
      data: trace
    })
    await expect(traceResponse).toBeOK()

    for (const width of [320, 390]) {
      await data.patchSettings({ historyBudget: width === 320 ? 80 : 40 })
      await page.setViewportSize({ width, height: 760 })
      await page.goto(`/stories/${story.id}`)

      await expect(page.getByTestId('pending-image-button')).toHaveCount(0)
      const composerButtonHeights = await page.evaluate(() =>
        ['Enviar', 'Sigue', 'Auto'].map((name) =>
          document.querySelector<HTMLButtonElement>(
            name === 'Enviar'
              ? 'button[type="submit"]'
              : `[data-testid="${name === 'Sigue' ? 'continue-button' : 'auto-button'}"]`
          )?.getBoundingClientRect().height
        )
      )
      expect(composerButtonHeights[1]).toBe(composerButtonHeights[0])
      expect(composerButtonHeights[2]).toBe(composerButtonHeights[0])

      await expect(page.getByRole('button', { name: 'Ver datos de debug de la llamada LLM' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Editar mensaje' }).first()).toBeVisible()
      await expect(page.getByRole('button', { name: 'Borrar mensaje' }).first()).toBeVisible()
      await expect(page.getByRole('button', { name: 'Regenerar desde este mensaje' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Reenviar este mensaje' })).toBeVisible()

      const debugButton = page.getByRole('button', { name: 'Ver datos de debug de la llamada LLM' })
      await debugButton.click()
      const debugDialog = page.getByRole('dialog', { name: 'Debug LLM' })
      await expect(debugDialog).toBeVisible()
      await expect(debugDialog.getByTestId('llm-debug-context-usage')).toContainText(
        width === 320 ? '66 / 80 caracteres · 82,5 % del límite' : '66 / 40 caracteres · 165 % del límite'
      )
      await expect(debugDialog.getByTestId('llm-debug-request-sections')).toBeVisible()
      await expect(debugDialog.getByText('Datos de llamada')).toBeVisible()
      await expect(debugDialog.getByText('LM Studio', { exact: true })).toBeVisible()
      await expect(debugDialog.getByText('test-model', { exact: true })).toBeVisible()
      await expect(debugDialog.getByText('Sistema · Mensaje 1')).toBeVisible()
      await expect(debugDialog.getByText('Narra con claridad.', { exact: true })).toBeVisible()
      await expect(debugDialog.getByText('Usuario · Mensaje 2')).toBeVisible()
      await expect(debugDialog.getByText('Miro la escena.', { exact: true })).toBeVisible()
      await expect(debugDialog.getByText('Asistente · Mensaje 3')).toBeVisible()
      await expect(debugDialog.getByTestId('llm-debug-response-json')).toContainText('Respuesta con dos imágenes.')
      await expect(debugDialog.getByTestId('llm-debug-request-json')).toHaveCount(0)
      await debugDialog.getByRole('button', { name: 'Ver JSON real' }).click()
      await expect(debugDialog.getByTestId('llm-debug-context-usage')).toBeVisible()
      await expect(debugDialog.getByTestId('llm-debug-request-json')).toContainText('"messages"')
      await debugDialog.getByRole('button', { name: 'Ver vista sencilla' }).click()
      await expect(debugDialog.getByTestId('llm-debug-request-sections')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true)
      await page.getByRole('button', { name: 'Cerrar debug LLM' }).click()

      const editButton = page.getByRole('button', { name: 'Editar mensaje' }).first()
      await editButton.click()
      await page.getByRole('button', { name: 'Cancelar' }).click()

      const equalCaption = page.getByRole('button', { name: `Ver tags LLM de ${firstCharacter.name}` })
      const differentCaption = page.getByRole('button', { name: `Ver tags LLM de ${secondCharacter.name}` })
      const differentTagLine = differentCaption.locator('span').filter({ hasText: 'LLM:' })
      await expect(equalCaption).toContainText(`${firstCharacter.name} · feliz · armadura`)
      await expect(equalCaption).not.toContainText('LLM:')
      await expect(differentCaption).toContainText(`${secondCharacter.name} · seria`)
      await expect(differentTagLine).toBeHidden()
      await differentCaption.click()
      await expect(differentCaption).toHaveAttribute('aria-expanded', 'true')
      await expect(differentTagLine).toBeVisible()
      await expect(differentCaption).toContainText('LLM: seria · capa')

      await page.reload()
      await expect(page.getByRole('button', { name: `Ver tags LLM de ${firstCharacter.name}` })).toContainText(
        `${firstCharacter.name} · feliz · armadura`
      )
      await expect(page.getByRole('button', { name: `Ver tags LLM de ${secondCharacter.name}` })).toContainText(
        `${secondCharacter.name} · seria`
      )
    }

    await data.patchSettings({ historyBudget: 0 })
    await page.reload()
    await page.getByRole('button', { name: 'Ver datos de debug de la llamada LLM' }).click()
    await expect(page.getByTestId('llm-debug-context-usage')).toContainText('66 caracteres · Sin límite')
    await page.getByRole('button', { name: 'Cerrar debug LLM' }).click()

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/stories/${story.id}`)
    const desktopCaption = page.getByRole('button', { name: `Ver tags LLM de ${secondCharacter.name}` })
    const desktopFigure = desktopCaption.locator('xpath=../..')
    await expect(desktopCaption.locator('..')).toHaveCSS('opacity', '0')
    await desktopFigure.hover()
    await expect(desktopCaption.locator('..')).toHaveCSS('opacity', '1')
    await expect(desktopCaption).toContainText('LLM: seria · capa')
  })

  test('crea imágenes en caliente, fija la primera y prioriza el turno siguiente', async ({ page, data }) => {
    const firstCharacter = await data.createCharacter({
      name: data.unique('Alicia-caliente'),
      imageGenerationPreset: 'Retrato',
      imageGenerationModel: 'model-a',
      imageGenerationLora: 'detail-lora',
      imageGenerationSeed: '42',
      imageGenerationPromptPrefix: 'quality'
    })
    const secondCharacter = await data.createCharacter({
      name: data.unique('Bruno-caliente'),
      imageGenerationPreset: 'Retrato',
      imageGenerationModel: 'model-a',
      imageGenerationSeed: '84',
      imageGenerationPromptPrefix: 'quality'
    })
    await data.createImage(firstCharacter, ['neutral'])
    await data.createImage(secondCharacter, ['neutral'])
    const story = await data.createStory({
      characters: [firstCharacter, secondCharacter],
      autoGenerateImages: true
    })
    await data.patchSettings({
      mockMode: false,
      model: 'qwen-test',
      useChromeLlm: false,
      privateUseChromeLlm: null,
      responseSpeed: 'instant',
      swarmBaseUrl: 'http://localhost:7801'
    })

    const firstResponse = [
      `Imagen ${firstCharacter.name} [nueva]: standing in a forest`,
      `${firstCharacter.name} [nueva]: Primera respuesta.`,
      `Imagen ${secondCharacter.name} [nueva]: standing in a forest`,
      `${secondCharacter.name} [nueva]: Segunda voz.`
    ].join('\n')
    const secondResponse = [
      `Imagen ${firstCharacter.name} [otra]: sitting in a tavern`,
      `${firstCharacter.name} [otra]: Respuesta del segundo turno.`
    ].join('\n')
    let llmCalls = 0
    const llmBodies: Array<Record<string, unknown>> = []
    await page.route('**/api/llm/chat', async (route) => {
      llmBodies.push(route.request().postDataJSON() as Record<string, unknown>)
      const response = llmCalls++ === 0 ? firstResponse : secondResponse
      await route.fulfill({ json: { content: response, finishReason: 'stop' } })
    })
    const bodies: Array<Record<string, unknown>> = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    let releaseVariant!: () => void
    const variantGate = new Promise<void>((resolve) => { releaseVariant = resolve })
    await page.route('**/api/swarm/generate', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      bodies.push(body)
      if (bodies.length <= 2) await firstGate
      else if (bodies.length === 3) await variantGate
      await route.fulfill({ contentType: 'image/png', body: PNG_BYTES })
    })

    await page.goto(`/stories/${story.id}`)
    const input = page.getByPlaceholder('Escribe lo que haces o dices…')
    await input.fill('Primer turno.')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(page.getByTestId('image-generation-status')).toBeVisible()
    await expect(page.getByText('Primera respuesta.', { exact: true })).toHaveCount(0)

    releaseFirst()
    await expect(page.getByText('Primera respuesta.', { exact: true })).toBeVisible()
    await expect(page.getByTestId('image-generation-status')).toBeVisible()
    const firstAssistantBeforeVariants = (await data.list<Message>('messages', 'normal', {
      storyId: story.id
    })).find((message) => message.role === 'assistant')
    const firstImageIdsBeforeVariants = firstAssistantBeforeVariants?.segments
      .filter((segment) => segment.type === 'dialogue')
      .map((segment) => segment.imageId)

    await input.fill('Segundo turno.')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect.poll(() => llmCalls).toBe(2)
    releaseVariant()
    await expect.poll(() => bodies.length).toBe(9)
    await expect(page.getByText('Respuesta del segundo turno.', { exact: true })).toBeVisible()
    expect(JSON.stringify(llmBodies[1])).toContain('[nueva]')

    expect(bodies[0]?.variationSeed).toBeUndefined()
    expect(bodies[1]?.variationSeed).toBeUndefined()
    expect(bodies[2]?.variationSeed).toEqual(expect.any(Number))
    expect(bodies[2]?.variationSeedStrength).toBe(0.5)
    expect(bodies[3]?.variationSeed).toBeUndefined()
    expect(String(bodies[3]?.prompt)).toContain('sitting in a tavern')
    expect(bodies[0]).toMatchObject({
      model: 'model-a',
      preset: 'Retrato',
      lora: 'detail-lora',
      seed: '42'
    })

    const messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
    const assistants = messages.filter((message) => message.role === 'assistant')
    expect(assistants).toHaveLength(2)
    expect(assistants.every((message) => !message.raw.includes('Imagen '))).toBe(true)
    expect(assistants[0]?.segments.filter((segment) => segment.type === 'dialogue').map((segment) => segment.imageId))
      .toEqual(firstImageIdsBeforeVariants)
    const traces = await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })
    expect(traces.find((trace) => trace.responseMessageId === assistants[0]?.id)?.response).toMatchObject({
      content: firstResponse
    })
    const generated = (await data.list<CharacterImage>('images', 'normal'))
      .filter((image) => image.generation)
    expect(generated).toHaveLength(9)
    expect(generated.every((image) => image.generation?.preset === 'Retrato')).toBe(true)
    expect(generated.every((image) => image.generation?.model === 'model-a')).toBe(true)
    expect(generated.every((image) => image.generation?.lora === (image.characterId === firstCharacter.id ? 'detail-lora' : undefined))).toBe(true)
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 800 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
  })

  test('avisa si falta modelo o preset y muestra la respuesta sin generar', async ({ page, data }) => {
    const character = await data.createCharacter({
      imageGenerationPreset: '',
      imageGenerationModel: ''
    })
    await data.createImage(character, ['neutral'])
    const story = await data.createStory({ characters: [character], autoGenerateImages: true })
    await data.patchSettings({
      mockMode: false,
      model: 'qwen-test',
      useChromeLlm: false,
      privateUseChromeLlm: null,
      responseSpeed: 'instant',
      swarmBaseUrl: 'http://localhost:7801'
    })
    const response = [
      `Imagen ${character.name} [nueva]: standing in a forest`,
      `${character.name} [nueva]: Respuesta conservada.`
    ].join('\n')
    let swarmCalls = 0
    await page.route('**/api/llm/chat', (route) =>
      route.fulfill({ json: { content: response, finishReason: 'stop' } }))
    await page.route('**/api/swarm/generate', (route) => {
      swarmCalls += 1
      return route.fulfill({ contentType: 'image/png', body: PNG_BYTES })
    })

    await page.goto(`/stories/${story.id}`)
    await page.getByPlaceholder('Escribe lo que haces o dices…').fill('Empiezo.')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(page.getByText('Respuesta conservada.', { exact: true })).toBeVisible()
    await expect(page.getByTestId('image-generation-warning')).toContainText('configura un preset o modelo')
    expect(swarmCalls).toBe(0)
    const messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
    expect(messages.find((message) => message.role === 'assistant')?.raw).toBe(`${character.name} [nueva]: Respuesta conservada.`)
  })

  test('cancela variantes y conserva el texto y las imágenes guardadas', async ({ page, data }) => {
    const character = await data.createCharacter({
      imageGenerationPreset: 'Retrato',
      imageGenerationModel: 'model-a',
      imageGenerationSeed: '42',
      imageGenerationPromptPrefix: 'quality'
    })
    await data.createImage(character, ['neutral'])
    const story = await data.createStory({ characters: [character], autoGenerateImages: true })
    await data.patchSettings({
      mockMode: false,
      model: 'qwen-test',
      useChromeLlm: false,
      privateUseChromeLlm: null,
      responseSpeed: 'instant',
      swarmBaseUrl: 'http://localhost:7801'
    })
    const response = [
      `Imagen ${character.name} [nueva]: standing in a forest`,
      `${character.name} [nueva]: Texto visible antes de cancelar.`
    ].join('\n')
    let swarmCalls = 0
    let releaseVariant!: () => void
    const variantGate = new Promise<void>((resolve) => { releaseVariant = resolve })
    await page.route('**/api/llm/chat', (route) =>
      route.fulfill({ json: { content: response, finishReason: 'stop' } }))
    await page.route('**/api/swarm/generate', async (route) => {
      swarmCalls += 1
      if (swarmCalls > 1) await variantGate
      await route.fulfill({ contentType: 'image/png', body: PNG_BYTES }).catch(() => {})
    })

    await page.goto(`/stories/${story.id}`)
    await page.getByPlaceholder('Escribe lo que haces o dices…').fill('Empiezo.')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(page.getByText('Texto visible antes de cancelar.', { exact: true })).toBeVisible()
    await expect.poll(() => swarmCalls).toBe(2)
    await page.getByTestId('cancel-image-generation').click()
    releaseVariant()
    await expect(page.getByTestId('image-generation-warning')).toContainText('Generación de imágenes cancelada')
    expect(await data.list<CharacterImage>('images', 'normal', { characterId: character.id })).toHaveLength(2)
    const messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
    expect(messages.find((message) => message.role === 'assistant')?.raw).toBe(`${character.name} [nueva]: Texto visible antes de cancelar.`)
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
  test('muestra etiquetas de imagen y etiquetas pedidas por el LLM al pasar por encima', async ({ page, data }) => {
    const { story, character, image } = await createStoryFixture(data, true)
    await data.createMessage({
      story,
      role: 'assistant',
      raw: 'Alicia aparece.',
      segments: [{
        type: 'dialogue',
        characterId: character.id,
        tag: 'seria',
        tags: ['seria'],
        imageId: image.id,
        text: 'Alicia aparece.'
      }]
    })

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/stories/${story.id}`)
    const figure = page.getByTestId('visual-novel-stage').locator('figure').first()
    const details = figure.getByTestId('visual-novel-image-details')
    await expect(details).toHaveCSS('opacity', '0')
    await figure.hover()
    await expect(details).toContainText(`${character.name} · feliz · armadura · LLM: seria`)
  })

  test('acciones avanzadas operan sobre el mensaje visible completo', async ({ page, data }) => {
    const { story } = await createStoryFixture(data, true)
    await data.patchSettings({ mockMode: true, responseSpeed: 'instant', visualNovelManualAdvance: false })
    await data.createMessage({ story, role: 'user', raw: 'Mensaje inicial.' })
    const assistant = await data.createMessage({
      story, role: 'assistant', raw: 'Primera frase.\nSegunda frase.',
      segments: [
        { type: 'narration', text: 'Primera frase.' },
        { type: 'narration', text: 'Segunda frase.' }
      ]
    })
    await data.createMessage({ story, role: 'user', raw: 'Mensaje posterior.' })
    const trace: LlmDebugTrace = {
      id: data.unique('trace'), storyId: story.id, responseMessageId: assistant.id,
      status: 'success', createdAt: Date.now(),
      request: { provider: 'lmstudio', model: 'test-model', messages: [], temperature: 0.7, max_tokens: 100, stream: false },
      response: { content: assistant.raw, finishReason: 'stop' }
    }
    for (const entry of [trace, {
      ...trace, id: data.unique('compaction'), requestMessageId: assistant.id,
      request: { ...trace.request, purpose: 'compaction' },
      response: { content: 'Resumen de prueba.', finishReason: 'stop' }
    }]) {
      await expect(await page.request.put(`/api/data/llmDebugTraces/${entry.id}?scope=normal`, { data: entry })).toBeOK()
    }

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/stories/${story.id}`)
    await page.getByTestId('visual-novel-previous').click()
    const frame = page.getByTestId('visual-novel-frame')
    await expect(frame).toContainText('Segunda frase.')
    const actions = page.getByTestId('visual-message-actions')
    await page.mouse.move(0, 0)
    await expect(actions).toHaveCSS('opacity', '0')
    await frame.hover()
    await expect(actions).toHaveCSS('opacity', '1')
    const bounds = await actions.boundingBox()
    const sceneBounds = await page.getByTestId('visual-novel-view').boundingBox()
    const dialogueBounds = await page.getByTestId('visual-novel-dialogue').boundingBox()
    expect(sceneBounds!.x + sceneBounds!.width - bounds!.x - bounds!.width).toBeLessThan(20)
    expect(dialogueBounds!.y - bounds!.y - bounds!.height).toBeLessThan(20)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(dialogueBounds!.y)
    await actions.getByRole('button', { name: 'Ver datos de debug de la llamada LLM' }).click()
    await expect(page.getByTestId('llm-debug-response-json')).toContainText('Segunda frase.')
    await page.getByRole('button', { name: 'Cerrar debug LLM' }).click()
    await actions.getByRole('button', { name: 'Ver datos de debug de la compactación' }).click()
    await expect(page.getByTestId('llm-debug-response-json')).toContainText('Resumen de prueba.')
    await page.getByRole('button', { name: 'Cerrar debug LLM' }).click()

    await actions.getByRole('button', { name: 'Editar mensaje' }).click()
    const editor = page.getByRole('dialog', { name: 'Editar mensaje' })
    const text = editor.getByLabel('Texto completo del mensaje')
    await expect(text).toHaveValue(assistant.raw)
    await expect(text).toBeFocused()
    await text.press('PageUp')
    await expect(frame).toContainText('Segunda frase.')
    await text.fill('No guardar esto.')
    await text.press('Escape')
    await expect(editor).toHaveCount(0)
    expect((await data.get<Message>('messages', assistant.id)).raw).toBe(assistant.raw)
    await actions.getByRole('button', { name: 'Editar mensaje' }).click()
    await text.fill('Primera editada.\nSegunda editada.')
    await editor.getByRole('button', { name: 'Guardar' }).click()
    await expect(editor).toHaveCount(0)
    await expect(frame).toContainText('Segunda editada.')
    expect((await data.get<Message>('messages', assistant.id)).raw).toBe('Primera editada.\nSegunda editada.')

    await actions.getByRole('button', { name: 'Regenerar desde este mensaje' }).click()
    await expect(page.getByRole('alertdialog')).toContainText('1 mensajes posteriores')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Regenerar' }).click()
    await expect.poll(async () => {
      const messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
      return messages.length === 2 && messages[1]?.role === 'assistant' && messages[1]?.id !== assistant.id
    }).toBe(true)
    const lastFrame = page.getByRole('button', { name: 'Ir a la última frase', exact: true })
    if (await lastFrame.isEnabled()) await lastFrame.click()
    await frame.hover()
    await actions.getByRole('button', { name: 'Borrar mensaje' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Borrar', exact: true }).click()
    await expect(frame).toContainText('Mensaje inicial.')
    await frame.hover()
    await actions.getByRole('button', { name: 'Reenviar este mensaje' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reenviar', exact: true }).click()
    await expect.poll(async () => (await data.list<Message>('messages', 'normal', { storyId: story.id })).length).toBe(2)
  })

  test('oculta acciones avanzadas de Visual Novel en móvil sin overflow', async ({ page, data }) => {
    const { story } = await createStoryFixture(data, true)
    await data.createMessage({ story, role: 'user', raw: 'Mensaje móvil.' })
    await page.goto(`/stories/${story.id}`)
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 760 })
      await expect(page.getByTestId('visual-novel-frame')).toContainText('Mensaje móvil.')
      await expect(page.getByTestId('visual-message-actions')).toBeHidden()
      await expect(page.getByRole('button', { name: 'Editar mensaje' })).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
  })

  test.describe('pantalla táctil', () => {
    test.use({ hasTouch: true })
    test('oculta acciones avanzadas incluso con anchura de tablet', async ({ page, data }) => {
      const { story } = await createStoryFixture(data, true)
      await data.createMessage({ story, role: 'user', raw: 'Mensaje táctil.' })
      await page.setViewportSize({ width: 1024, height: 768 })
      await page.goto(`/stories/${story.id}`)
      await expect(page.getByTestId('visual-novel-frame')).toContainText('Mensaje táctil.')
      await expect(page.getByTestId('visual-message-actions')).toBeHidden()
    })
  })

  test('activa modo privado con tres pulsaciones desde una historia inexistente', async ({ page }) => {
    await page.goto('/stories/historia-inexistente')
    const trigger = page.getByTestId('missing-story-private-trigger')
    await expect(page.getByText('Historia no encontrada.')).toBeVisible()
    await trigger.click()
    await trigger.click()
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')
    await trigger.click()
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('button', { name: 'Salir del modo privado' })).toBeVisible()
  })

  test('muestra y vuelve a reproducir sonidos al navegar en Novela Visual', async ({ page, data }) => {
    const { story, character } = await createStoryFixture(data, true)
    const sound = await data.createSound(character, ['campana'])
    await data.createMessage({
      story,
      role: 'assistant',
      raw: 'Antes. Sonido. Después.',
      segments: [
        { type: 'narration', characterId: null, tag: null, text: 'Antes.' },
        {
          type: 'sound',
          characterId: null,
          soundId: sound.id,
          tag: sound.tags[0]!,
          text: ''
        },
        { type: 'narration', characterId: null, tag: null, text: 'Después.' }
      ]
    })
    await page.addInitScript(() => {
      const state = window as typeof window & { __visualSoundPlays: number }
      state.__visualSoundPlays = 0
      HTMLMediaElement.prototype.play = function () {
        state.__visualSoundPlays += 1
        return Promise.resolve()
      }
    })

    await page.goto(`/stories/${story.id}`)
    await page.getByTestId('story-start-button').click()
    await expect(page.getByTestId('visual-novel-frame')).toContainText('Antes.')
    await page.getByTestId('visual-novel-next').click()
    const soundFrame = page.getByTestId('visual-novel-sound')
    await expect(soundFrame).toContainText('Sonido [campana]')
    await expect(soundFrame.locator('audio')).toBeVisible()
    await expect.poll(() => page.evaluate(() => (
      window as typeof window & { __visualSoundPlays: number }
    ).__visualSoundPlays)).toBeGreaterThanOrEqual(1)

    await page.getByTestId('visual-novel-next').click()
    await expect(page.getByTestId('visual-novel-frame')).toContainText('Después.')
    await page.getByTestId('visual-novel-previous').click()
    await expect(soundFrame).toBeVisible()
    await expect.poll(() => page.evaluate(() => (
      window as typeof window & { __visualSoundPlays: number }
    ).__visualSoundPlays)).toBeGreaterThanOrEqual(2)
  })

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

  test('los botones de inicio y fin saltan a la primera y última frase', async ({ page, data }) => {
    const { story, character, image } = await createStoryFixture(data, true)
    await data.createMessage({ story, role: 'user', raw: 'Primera frase.' })
    await data.createMessage({
      story,
      role: 'assistant',
      raw: 'Narración. Diálogo.',
      segments: [
        { type: 'narration', characterId: null, tag: null, text: 'Frase intermedia.' },
        {
          type: 'dialogue',
          characterId: character.id,
          tag: 'feliz',
          imageId: image.id,
          text: 'Última frase.'
        }
      ]
    })

    await page.goto(`/stories/${story.id}`)
    await expect(page.getByTestId('visual-novel-counter')).toHaveText('3 / 3')
    await page.getByTestId('story-start-button').click()
    await expect(page.getByTestId('visual-novel-counter')).toHaveText('1 / 3')
    await expect(page.getByTestId('visual-novel-frame')).toContainText('Primera frase.')
    await page.getByTestId('story-end-button').click()
    await expect(page.getByTestId('visual-novel-counter')).toHaveText('3 / 3')
    await expect(page.getByTestId('visual-novel-frame')).toContainText('Última frase.')
  })

  test('no muestra prefijos de imagen mientras pinta una respuesta visual', async ({ page, data }) => {
    const { story, character, background } = await createStoryFixture(data, true)
    const sound = await data.createSound(character, [data.unique('pasos-prueba')])
    const response = await prepareVisualResponse(page, data, [
      `Fondo [${background.tags[0]}]:`,
      `${character.name} [feliz][armadura]: Primera intervención completa.`,
      `Sonido [${sound.tags[0]}]:`,
      'Vera: Segunda intervención completa.',
      `${character.name} [feliz]: Última intervención completa.`
    ].join('\n'), false)

    await page.goto(`/stories/${story.id}`)
    await pauseVisualClock(page)
    await page.evaluate(() => {
      const seen: string[] = []
      Object.assign(window, { __visualFrameTexts: seen })
      new MutationObserver(() => {
        // El reproductor «Sonido [etiqueta]» es un fotograma válido, no un
        // prefijo de imagen filtrado al texto del diálogo o la narración.
        const text = document.querySelector('[data-testid="visual-novel-frame"] > p')?.textContent ?? ''
        if (text.trim()) seen.push(text)
      }).observe(document.body, { childList: true, characterData: true, subtree: true })
    })

    await page.getByTestId('continue-button').click()
    await response.requested
    response.release()
    await expect(page.getByRole('button', { name: 'Parar', exact: true })).toBeVisible()
    await expect(page.getByTestId('visual-novel-counter')).toHaveText('1 / 4')
    await page.clock.runFor(60_000)
    await expect(page.getByRole('button', { name: 'Parar', exact: true })).toBeHidden()
    await expect(page.getByTestId('visual-novel-counter')).toHaveText('4 / 4')
    await expect(page.getByTestId('visual-novel-frame')).toContainText('Última intervención completa.')

    const seen = await page.evaluate(() =>
      (window as typeof window & { __visualFrameTexts?: string[] }).__visualFrameTexts ?? []
    )
    expect(seen.some((text) => text.includes('Primera intervención completa.'))).toBe(true)
    expect(seen.some((text) => text.includes('Segunda intervención completa.'))).toBe(true)
    expect(seen.some((text) => text.includes('['))).toBe(false)
  })

  test('anticipa el total completo y lo descarta al parar', async ({ page, data }) => {
    const { story } = await createStoryFixture(data, true)
    await data.createMessage({ story, role: 'user', raw: 'Frase ya visible.' })
    await data.patchSettings({
      mockMode: true,
      responseSpeed: 'slow',
      visualNovelManualAdvance: false
    })

    await page.goto(`/stories/${story.id}`)
    await page.getByTestId('continue-button').click()
    const counter = page.getByTestId('visual-novel-counter')
    await expect.poll(async () => {
      const [visible, total] = (await counter.innerText())
        .split('/')
        .map((value) => Number(value.trim()))
      return total > visible
    }, { timeout: 10_000 }).toBe(true)

    const anticipatedTotal = Number((await counter.innerText()).split('/')[1]?.trim())
    await page.getByRole('button', { name: 'Parar', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Parar', exact: true })).toBeHidden()
    const [visibleAfterStop, totalAfterStop] = (await counter.innerText())
      .split('/')
      .map((value) => Number(value.trim()))
    expect(totalAfterStop).toBe(visibleAfterStop)
    expect(totalAfterStop).toBeLessThan(anticipatedTotal)
  })

  test('completa solo la intervención actual al pulsar el texto', async ({ page, data }) => {
    const { story, character } = await createStoryFixture(data, true)
    const firstLine = `${character.name}: Primera intervención suficientemente larga para completar.`
    const response = await prepareVisualResponse(page, data, [
      firstLine,
      'Segunda intervención que debe seguir pintándose progresivamente.'
    ].join('\n'), false)

    await page.goto(`/stories/${story.id}`)
    await pauseVisualClock(page)
    await page.getByTestId('continue-button').click()
    await response.requested
    response.release()
    const frame = page.getByTestId('visual-novel-frame')
    const counter = page.getByTestId('visual-novel-counter')
    await expect(counter).toHaveText('1 / 2')
    await page.clock.runFor(500)
    await expect(frame).not.toHaveText(firstLine)

    await frame.click()
    await expect(frame).toHaveText(firstLine)
    await expect(counter).toHaveText('1 / 2')
    await page.clock.runFor(300)
    await expect(page.getByRole('button', { name: 'Parar', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Parar', exact: true }).click()
  })

  test('completa la intervención actual con flecha derecha antes de avanzar', async ({ page, data }) => {
    const { story, character } = await createStoryFixture(data, true)
    const firstLine = `${character.name}: Primera intervención suficientemente larga para completar.`
    const response = await prepareVisualResponse(page, data, [
      firstLine,
      'Segunda intervención que debe seguir pintándose progresivamente.'
    ].join('\n'))

    await page.goto(`/stories/${story.id}`)
    await pauseVisualClock(page)
    await page.getByTestId('continue-button').click()
    await response.requested
    response.release()
    const frame = page.getByTestId('visual-novel-frame')
    const counter = page.getByTestId('visual-novel-counter')
    await expect(counter).toHaveText('1 / 2')
    await page.clock.runFor(500)
    await expect(frame).not.toHaveText(firstLine)
    await focusVisualKeyboard(page)

    await page.keyboard.press('ArrowRight')
    await expect(frame).toHaveText(firstLine)
    await expect(counter).toHaveText('1 / 2')
    await page.clock.runFor(5_000)
    await expect(frame).toHaveText(firstLine)
    await expect(counter).toHaveText('1 / 2')
    await page.keyboard.press('ArrowRight')
    await expect(counter).toHaveText('2 / 2')
    await expect(page.getByRole('button', { name: 'Parar', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Parar', exact: true }).click()
  })

  test('PageUp y PageDown controlan la novela con foco en el cuadro de escritura', async ({ page, data }) => {
    const { story } = await createStoryFixture(data, true)
    await data.patchSettings({
      mockMode: true,
      responseSpeed: 'slow',
      visualNovelManualAdvance: true
    })

    await page.goto(`/stories/${story.id}`)
    await page.evaluate(() => {
      Math.random = () => 0
    })
    await page.getByTestId('continue-button').click()
    const frame = page.getByTestId('visual-novel-frame')
    const counter = page.getByTestId('visual-novel-counter')
    await expect.poll(async () => (await frame.innerText()).trim(), { timeout: 15_000 })
      .not.toBe('La historia aún no ha empezado.')
    const beforeText = (await frame.innerText()).trim()
    const beforeIndex = Number((await counter.innerText()).split('/')[0]?.trim())
    const input = page.getByPlaceholder('Escribe lo que haces o dices…')
    await input.fill('Texto sin enviar')

    await input.press('PageDown')
    expect((await frame.innerText()).trim().length).toBeGreaterThan(beforeText.length + 5)
    await input.press('PageDown')
    await expect.poll(async () => Number((await counter.innerText()).split('/')[0]?.trim()))
      .toBe(beforeIndex + 1)
    await input.press('PageUp')
    await expect.poll(async () => Number((await counter.innerText()).split('/')[0]?.trim()))
      .toBe(beforeIndex)
    await expect(input).toHaveValue('Texto sin enviar')
    await page.getByRole('button', { name: 'Parar', exact: true }).click()
  })

  test('el botón siguiente completa la frase activa y permite avanzar sin espera', async ({ page, data }) => {
    const { story } = await createStoryFixture(data, true)
    await data.patchSettings({
      mockMode: true,
      responseSpeed: 'slow',
      visualNovelManualAdvance: true
    })

    await page.goto(`/stories/${story.id}`)
    await page.evaluate(() => {
      Math.random = () => 0
    })
    await page.getByTestId('continue-button').click()
    const frame = page.getByTestId('visual-novel-frame')
    const next = page.getByTestId('visual-novel-next')
    const counter = page.getByTestId('visual-novel-counter')
    await expect.poll(async () => (await frame.innerText()).trim(), { timeout: 15_000 })
      .not.toBe('La historia aún no ha empezado.')
    await expect(next).toBeEnabled()
    const beforeText = (await frame.innerText()).trim()
    const beforeIndex = Number((await counter.innerText()).split('/')[0]?.trim())

    await next.click()
    expect((await frame.innerText()).trim().length).toBeGreaterThan(beforeText.length + 5)
    await expect(next).toBeEnabled()
    await next.click()
    await expect.poll(async () =>
      Number((await counter.innerText()).split('/')[0]?.trim())
    ).toBe(beforeIndex + 1)

    await page.getByRole('button', { name: 'Parar', exact: true }).click()
  })

  test('no fuerza el avance al retroceder mientras sigue pintando', async ({ page, data }) => {
    const { story, character, image } = await createStoryFixture(data, true)
    await data.createMessage({
      story,
      role: 'assistant',
      raw: 'Última frase anterior.',
      segments: [{
        type: 'dialogue',
        characterId: character.id,
        tag: 'feliz',
        imageId: image.id,
        text: 'Última frase anterior.'
      }]
    })
    await data.patchSettings({
      mockMode: true,
      responseSpeed: 'medium',
      visualNovelManualAdvance: false
    })

    await page.goto(`/stories/${story.id}`)
    await page.evaluate(() => {
      Math.random = () => 0
    })
    await page.getByTestId('continue-button').click()
    const frame = page.getByTestId('visual-novel-frame')
    await expect(frame).not.toContainText('Última frase anterior.', { timeout: 15_000 })
    const revealingText = (await frame.innerText()).trim()
    await page.getByTestId('visual-novel-previous').click()
    await expect(frame).toContainText('Última frase anterior.')

    await page.waitForTimeout(4_000)
    await expect(frame).toContainText('Última frase anterior.')
    await page.keyboard.press('ArrowRight')
    await expect(frame).not.toContainText('Última frase anterior.')
    expect((await frame.innerText()).trim().length).toBeLessThanOrEqual(revealingText.length + 5)
    await page.getByRole('button', { name: 'Parar', exact: true }).click()
  })

  test('la flecha derecha navega desde una frase anterior sin completar la activa', async ({ page, data }) => {
    const { story, character, image } = await createStoryFixture(data, true)
    await data.createMessage({
      story,
      role: 'assistant',
      raw: 'Última frase anterior.',
      segments: [{
        type: 'dialogue',
        characterId: character.id,
        tag: 'feliz',
        imageId: image.id,
        text: 'Última frase anterior.'
      }]
    })
    await data.patchSettings({
      mockMode: true,
      responseSpeed: 'slow',
      visualNovelManualAdvance: false
    })

    await page.goto(`/stories/${story.id}`)
    await page.evaluate(() => {
      Math.random = () => 0
    })
    await page.getByTestId('continue-button').click()
    const frame = page.getByTestId('visual-novel-frame')
    await expect(frame).not.toContainText('Última frase anterior.', { timeout: 15_000 })
    const revealingText = (await frame.innerText()).trim()
    await page.getByTestId('visual-novel-previous').click()
    await expect(frame).toContainText('Última frase anterior.')

    await page.keyboard.press('ArrowRight')
    await expect(frame).not.toContainText('Última frase anterior.')
    expect((await frame.innerText()).trim().length).toBeLessThanOrEqual(revealingText.length + 2)

    await page.getByRole('button', { name: 'Parar', exact: true }).click()
  })

  test('espacio y Enter controlan una frase manual sin dobles avances', async ({ page, data }) => {
    const { story, character } = await createStoryFixture(data, true)
    const firstLine = `${character.name}: Primera frase suficientemente larga para comprobar el revelado.`
    const secondLine = 'Vera: Segunda frase suficientemente larga para comprobar el avance.'
    const response = await prepareVisualResponse(page, data, [
      `${character.name} [feliz]: Primera frase suficientemente larga para comprobar el revelado.`,
      secondLine,
      'La escena termina.'
    ].join('\n'))

    await page.goto(`/stories/${story.id}`)
    await pauseVisualClock(page)
    await page.getByTestId('continue-button').click()
    await response.requested
    response.release()
    const frame = page.getByTestId('visual-novel-frame')
    const counter = page.getByTestId('visual-novel-counter')
    await expect(counter).toHaveText('1 / 3')
    await page.clock.runFor(500)
    await expect(frame).not.toHaveText(firstLine)
    await focusVisualKeyboard(page)

    await page.keyboard.press('Space')
    await expect(frame).toHaveText(firstLine)
    await expect(counter).toHaveText('1 / 3')
    await page.clock.runFor(5_000)
    await expect(frame).toHaveText(firstLine)

    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: ' ',
        repeat: true,
        bubbles: true
      }))
    })
    await expect(frame).toHaveText(firstLine)
    await expect(counter).toHaveText('1 / 3')

    const input = page.getByPlaceholder('Escribe lo que haces o dices…')
    await input.press('Enter')
    await expect(frame).toHaveText(firstLine)
    await expect(counter).toHaveText('1 / 3')
    await focusVisualKeyboard(page)

    await page.keyboard.press('Enter')
    await expect(counter).toHaveText('2 / 3')
    const startedText = (await frame.innerText()).trim()
    await page.clock.runFor(500)
    expect((await frame.innerText()).trim().length).toBeGreaterThan(startedText.length)
    await expect(counter).toHaveText('2 / 3')
    await page.keyboard.press('Enter')
    await expect(frame).toHaveText(secondLine)
    await expect(counter).toHaveText('2 / 3')

    await page.getByRole('button', { name: 'Parar', exact: true }).click()
  })

  test('salta a la primera frase nueva y pinta al protagonista progresivamente', async ({ page, data }) => {
    const { story, character, image } = await createStoryFixture(data, true)
    await data.createMessage({
      story,
      role: 'assistant',
      raw: 'Frase anterior.',
      segments: [{
        type: 'dialogue',
        characterId: character.id,
        tag: 'feliz',
        imageId: image.id,
        text: 'Frase anterior.'
      }]
    })
    const response = await prepareVisualResponse(page, data, [
      `${character.name} [feliz]: Primera frase nueva suficientemente larga.`,
      'Vera: Decido seguir adelante con mucha cautela.',
      'La escena termina.'
    ].join('\n'))

    await page.goto(`/stories/${story.id}`)
    await pauseVisualClock(page)
    const frame = page.getByTestId('visual-novel-frame')
    const counter = page.getByTestId('visual-novel-counter')
    await expect(counter).toHaveText('1 / 1')
    await page.getByTestId('auto-button').click()
    await response.requested
    response.release()

    await expect(counter).toHaveText('2 / 4')
    await expect(frame).not.toContainText('Frase anterior.')
    const firstStartedText = (await frame.innerText()).trim()
    await page.clock.runFor(500)
    expect((await frame.innerText()).trim().length).toBeGreaterThan(firstStartedText.length)

    await focusVisualKeyboard(page)
    await page.keyboard.press('Space')
    await expect(frame).toHaveText(`${character.name}: Primera frase nueva suficientemente larga.`)
    await expect(counter).toHaveText('2 / 4')
    await page.keyboard.press('Space')
    await expect(counter).toHaveText('3 / 4')
    await expect(frame).toContainText('Vera:')
    const protagonistStartedText = (await frame.innerText()).trim()
    await page.clock.runFor(500)
    expect((await frame.innerText()).trim().length).toBeGreaterThan(protagonistStartedText.length)
    await expect(counter).toHaveText('3 / 4')

    await page.getByRole('button', { name: 'Parar', exact: true }).click()
  })

  test('muestra el mensaje escrito aunque el avance manual esté activo', async ({ page, data }) => {
    const { story, character, image } = await createStoryFixture(data, true)
    const response = await prepareVisualResponse(page, data, [
      `${character.name} [feliz]: Respuesta nueva suficientemente larga.`,
      'Vera: Seguimos adelante.'
    ].join('\n'))
    await data.createMessage({ story, role: 'user', raw: 'Mensaje anterior.' })
    await data.createMessage({
      story,
      role: 'assistant',
      raw: 'Respuesta anterior.',
      segments: [
        {
          type: 'dialogue',
          characterId: character.id,
          tag: 'feliz',
          imageId: image.id,
          text: 'Respuesta anterior.'
        }
      ]
    })

    await page.goto(`/stories/${story.id}`)
    await pauseVisualClock(page)
    await page.getByTestId('visual-novel-previous').click()
    await expect(page.getByTestId('visual-novel-frame')).toContainText('Mensaje anterior.')

    const submitted = data.unique('Nuevo-mensaje-manual')
    await page.getByPlaceholder('Escribe lo que haces o dices…').fill(submitted)
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await response.requested
    const frame = page.getByTestId('visual-novel-frame')
    const counter = page.getByTestId('visual-novel-counter')
    await expect(frame).toHaveText(`Vera: ${submitted}`)
    await expect(counter).toHaveText('3 / 3')
    await page.clock.runFor(5_000)
    await expect(frame).toHaveText(`Vera: ${submitted}`)
    response.release()
    await expect(counter).toHaveText('4 / 5')
    await expect(frame).toContainText(`${character.name}:`)
    await expect(frame).not.toContainText(submitted)
    const startedText = (await frame.innerText()).trim()
    await page.clock.runFor(500)
    expect((await frame.innerText()).trim().length).toBeGreaterThan(startedText.length)
    await expect(page.getByRole('button', { name: 'Parar', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Parar', exact: true }).click()
  })

  test('adapta los hablantes visibles al ancho y los mantiene durante narración', async ({ page, data }) => {
    const first = await data.createCharacter({ name: data.unique('Primero') })
    const second = await data.createCharacter({ name: data.unique('Segundo') })
    const third = await data.createCharacter({ name: data.unique('Tercero') })
    const [firstImage, secondImage, thirdImage] = await Promise.all([
      data.createImage(first, ['primero']),
      data.createImage(second, ['segundo']),
      data.createImage(third, ['tercero'])
    ])
    const story = await data.createStory({
      characters: [first, second, third],
      visualMode: true
    })
    await data.createMessage({
      story,
      role: 'assistant',
      raw: 'Primero. Segundo. Pausa. Tercero. Otra pausa.',
      segments: [
        {
          type: 'dialogue',
          characterId: first.id,
          tag: 'primero',
          imageId: firstImage.id,
          text: 'Habla primero.'
        },
        {
          type: 'dialogue',
          characterId: second.id,
          tag: 'segundo',
          imageId: secondImage.id,
          text: 'Habla segundo.'
        },
        { type: 'narration', characterId: null, tag: null, text: 'Pausa entre ambos.' },
        {
          type: 'dialogue',
          characterId: third.id,
          tag: 'tercero',
          imageId: thirdImage.id,
          text: 'Habla tercero.'
        },
        { type: 'narration', characterId: null, tag: null, text: 'Otra pausa.' }
      ]
    })

    await page.goto(`/stories/${story.id}`)
    const cast = page.getByTestId('visual-novel-cast').locator('figure')
    await expect(cast).toHaveCount(3)
    await expect(cast.nth(0)).toHaveAttribute('data-character-id', first.id)
    await expect(cast.nth(1)).toHaveAttribute('data-character-id', second.id)
    await expect(cast.nth(2)).toHaveAttribute('data-character-id', third.id)

    await page.setViewportSize({ width: 390, height: 760 })
    await expect(cast).toHaveCount(2)
    await expect(cast.nth(0)).toHaveAttribute('data-character-id', second.id)
    await expect(cast.nth(1)).toHaveAttribute('data-character-id', third.id)

    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByTestId('visual-novel-frame')).toContainText('Pausa entre ambos.')
    await expect(cast.nth(0)).toHaveAttribute('data-character-id', first.id)
    await expect(cast.nth(1)).toHaveAttribute('data-character-id', second.id)
  })

  test('mantiene navegación por mitades en el texto móvil', async ({ page, data }) => {
    const { story, character, image } = await createStoryFixture(data, true)
    await data.createMessage({ story, role: 'user', raw: 'Primera frase móvil.' })
    await data.createMessage({
      story,
      role: 'assistant',
      raw: 'Segunda frase móvil.',
      segments: [{
        type: 'dialogue',
        characterId: character.id,
        tag: 'feliz',
        imageId: image.id,
        text: 'Segunda frase móvil.'
      }]
    })
    await page.setViewportSize({ width: 390, height: 760 })
    await page.goto(`/stories/${story.id}`)

    const frame = page.getByTestId('visual-novel-frame')
    const size = await frame.boundingBox()
    expect(size).not.toBeNull()
    await frame.click({ position: { x: 4, y: Math.max(4, (size?.height ?? 8) / 2) } })
    await expect(frame).toContainText('Primera frase móvil.')
    await frame.click({
      position: {
        x: Math.max(4, (size?.width ?? 8) - 4),
        y: Math.max(4, (size?.height ?? 8) / 2)
      }
    })
    await expect(frame).toContainText('Segunda frase móvil.')
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

      await page.getByTestId('visual-mode-toggle').click()
      await expect(page.getByTestId('story-start-button')).toBeVisible()
      await expect(page.getByTestId('story-end-button')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true)
    })
  }
})

test.describe('selección de imágenes durante la historia', () => {
  test('cambia una imagen enviada en Chat y Novela sin alterar texto ni etiquetas', async ({ page, data }) => {
    const character = await data.createCharacter({ name: data.unique('Alicia') })
    const otherCharacter = await data.createCharacter({ name: data.unique('Bruno') })
    const first = await data.createImage(character, ['feliz'])
    const second = await data.createImage(character, ['seria', 'capa'])
    await data.createImage(otherCharacter, ['alerta'])
    const story = await data.createStory({ characters: [character, otherCharacter] })
    const storyCharacterName = data.unique('Alias-Alicia')
    story.characterCustomizations[0]!.name = storyCharacterName
    const storyResponse = await page.request.put(`/api/data/stories/${story.id}?scope=normal`, {
      data: story
    })
    expect(storyResponse.ok()).toBe(true)
    const message = await data.createMessage({
      story,
      role: 'assistant',
      raw: `${character.name} [feliz]: Hola.`,
      segments: [
        {
          type: 'dialogue',
          characterId: character.id,
          tag: 'feliz',
          tags: ['feliz'],
          imageId: first.id,
          text: 'Hola.'
        },
        { type: 'narration', characterId: null, tag: null, text: 'Pasa un instante.' }
      ]
    })

    await page.goto(`/stories/${story.id}`)
    await page.getByRole('button', { name: new RegExp(`Cambiar ${storyCharacterName}`) }).click()
    let dialog = page.getByRole('dialog', { name: 'Cambiar imagen' })
    await expect(dialog.getByLabel('Personaje para la imagen')).toHaveCount(0)
    await expect(dialog.getByText(`Personaje: ${storyCharacterName}`, { exact: true })).toBeVisible()
    await expect(dialog.getByText(`Personaje: ${character.name}`, { exact: true })).toHaveCount(0)
    await expect(dialog.getByText(`Personaje: ${otherCharacter.name}`, { exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('checkbox', { name: /Indicar a la IA/ })).toBeChecked()
    await dialog.getByRole('button', {
      name: `Seleccionar imagen de ${storyCharacterName} [seria][capa]`
    }).dblclick()
    await expect(dialog).toBeHidden()

    let stored = await data.get<Message>('messages', message.id)
    expect(stored.raw).toBe(message.raw)
    expect(stored.segments[0]).toMatchObject({
      imageId: second.id,
      imageIdOverride: true,
      tag: 'feliz',
      tags: ['feliz'],
      text: 'Hola.'
    })
    await expect(page.getByRole('button', { name: `Ver tags LLM de ${storyCharacterName}` })).toContainText(
      `${storyCharacterName} · seria · capa`
    )

    await page.getByTestId('visual-mode-toggle').click()
    await page.getByRole('button', { name: `Cambiar imagen de ${character.name}` }).click()
    dialog = page.getByRole('dialog', { name: 'Cambiar imagen' })
    await dialog.getByRole('button', {
      name: `Seleccionar imagen de ${storyCharacterName} [feliz]`
    }).dblclick()
    await expect(dialog).toBeHidden()
    stored = await data.get<Message>('messages', message.id)
    expect(stored.segments[0]?.imageId).toBe(first.id)

    await page.reload()
    await expect(page.getByRole('button', {
      name: `Cambiar imagen de ${character.name}`
    })).toBeVisible()
  })

  test('propaga el cambio a imágenes siguientes con mismo personaje y etiquetas', async ({ page, data }) => {
    const character = await data.createCharacter({ name: data.unique('Alicia') })
    const otherCharacter = await data.createCharacter({ name: data.unique('Bruno') })
    const previous = await data.createImage(character, ['feliz', 'capa'])
    const origin = await data.createImage(character, ['feliz', 'capa'])
    const following = await data.createImage(character, ['feliz', 'capa'])
    const different = await data.createImage(character, ['seria'])
    const selected = await data.createImage(character, ['seleccionada'])
    const other = await data.createImage(otherCharacter, ['feliz', 'capa'])
    const story = await data.createStory({ characters: [character, otherCharacter] })
    const message = await data.createMessage({
      story,
      role: 'assistant',
      raw: 'Respuesta con varias imágenes.',
      segments: [
        {
          type: 'dialogue',
          characterId: character.id,
          tag: 'feliz',
          tags: ['feliz', 'capa'],
          imageId: previous.id,
          text: 'Anterior.'
        },
        { type: 'narration', characterId: null, tag: null, text: 'Pausa.' },
        {
          type: 'dialogue',
          characterId: character.id,
          tag: 'feliz',
          tags: ['feliz', 'capa'],
          imageId: origin.id,
          text: 'Origen.'
        },
        {
          type: 'dialogue',
          characterId: character.id,
          tag: 'feliz',
          tags: ['capa', 'FELIZ'],
          imageId: following.id,
          text: 'Siguiente.'
        },
        {
          type: 'dialogue',
          characterId: character.id,
          tag: 'seria',
          tags: ['seria'],
          imageId: different.id,
          text: 'Distinta.'
        },
        {
          type: 'dialogue',
          characterId: otherCharacter.id,
          tag: 'feliz',
          tags: ['feliz', 'capa'],
          imageId: other.id,
          text: 'Otro personaje.'
        }
      ]
    })

    await page.goto(`/stories/${story.id}`)
    await page.getByRole('button', { name: new RegExp(`Cambiar ${character.name}`) }).nth(1).click()
    const dialog = page.getByRole('dialog', { name: 'Cambiar imagen' })
    await dialog.getByRole('button', {
      name: `Seleccionar imagen de ${character.name} [seleccionada]`
    }).dblclick()

    const stored = await data.get<Message>('messages', message.id)
    expect(stored.segments.map((segment) => segment.imageId)).toEqual([
      previous.id,
      undefined,
      selected.id,
      selected.id,
      different.id,
      other.id
    ])
    expect(stored.segments[2]?.imageIdOverride).toBe(true)
    expect(stored.segments[3]?.imageIdOverride).toBe(true)
    expect(stored.segments[0]?.imageIdOverride).toBeUndefined()
    expect(stored.raw).toBe(message.raw)
  })

  test('aprovecha monitores anchos para mostrar más imágenes', async ({ page, data }) => {
    const character = await data.createCharacter({ name: data.unique('Alicia') })
    const images: CharacterImage[] = []
    for (let index = 0; index < 8; index += 1) {
      images.push(await data.createImage(character, [`imagen-${index}`]))
    }
    const story = await data.createStory({ characters: [character] })
    await data.createMessage({
      story,
      role: 'assistant',
      raw: 'Imagen inicial.',
      segments: [{
        type: 'dialogue',
        characterId: character.id,
        tag: 'imagen-0',
        tags: ['imagen-0'],
        imageId: images[0]!.id,
        text: 'Imagen inicial.'
      }]
    })

    await page.setViewportSize({ width: 1600, height: 900 })
    await page.goto(`/stories/${story.id}`)
    await page.getByRole('button', { name: new RegExp(`Cambiar ${character.name}`) }).click()
    const dialog = page.getByRole('dialog', { name: 'Cambiar imagen' })
    const panelBox = await dialog.locator('section').boundingBox()
    expect(panelBox?.width).toBeGreaterThan(1100)
    const thumbnails = dialog.getByRole('button', { name: /^Seleccionar imagen/ })
    await expect(thumbnails).toHaveCount(8)
    const firstRowTop = (await thumbnails.nth(0).boundingBox())?.y
    for (let index = 1; index < 6; index += 1) {
      expect((await thumbnails.nth(index).boundingBox())?.y).toBe(firstRowTop)
    }
  })

  test('persiste indicación, la conserva tras fallo y la consume tras respuesta válida', async ({ page, data }) => {
    const firstCharacter = await data.createCharacter({ name: data.unique('Alicia') })
    const secondCharacter = await data.createCharacter({ name: data.unique('Bruno') })
    const neutral = await data.createImage(firstCharacter, ['neutral'])
    const requested = await data.createImage(firstCharacter, ['seria', 'capa'])
    await data.createImage(secondCharacter, ['alerta'])
    const preset = await data.createPreset()
    const story = await data.createStory({ characters: [firstCharacter, secondCharacter], preset })
    await data.createMessage({
      story,
      role: 'assistant',
      raw: 'Imagen inicial.',
      segments: [{
        type: 'dialogue',
        characterId: firstCharacter.id,
        tag: 'neutral',
        tags: ['neutral'],
        imageId: neutral.id,
        text: 'Imagen inicial.'
      }]
    })
    const secondStoryName = data.unique('Alias-Bruno')
    story.characterCustomizations[1]!.name = secondStoryName
    const storyResponse = await page.request.put(`/api/data/stories/${story.id}?scope=normal`, {
      data: story
    })
    expect(storyResponse.ok()).toBe(true)
    await data.patchSettings({
      mockMode: false,
      model: '',
      responseSpeed: 'instant',
      useChromeLlm: true,
      privateUseChromeLlm: null
    })
    await page.addInitScript((response) => {
      type PromptMessage = { role: string; content: string }
      type ChromeWindow = Window & {
        __chromeFail?: boolean
        __chromePrompts?: PromptMessage[][]
      }
      ;(window as ChromeWindow).__chromeFail = true
      ;(window as ChromeWindow).__chromePrompts = []

      class FakeLanguageModel {
        static async availability() { return 'available' }
        static async create() { return new FakeLanguageModel() }
        async prompt(messages: PromptMessage[]) {
          const target = window as ChromeWindow
          target.__chromePrompts?.push(messages)
          if (target.__chromeFail) throw new Error('fallo visual simulado')
          return response
        }
        destroy() {}
      }
      Object.defineProperty(globalThis, 'LanguageModel', { configurable: true, value: FakeLanguageModel })
    }, `${firstCharacter.name} [seria][capa]: Estoy lista.`)

    await page.goto(`/stories/${story.id}`)
    await page.getByRole('button', { name: new RegExp(`Cambiar ${firstCharacter.name}`) }).click()
    const dialog = page.getByRole('dialog', { name: 'Cambiar imagen' })
    await expect(dialog.getByText(`Personaje: ${firstCharacter.name}`, { exact: true })).toBeVisible()
    await expect(dialog.getByRole('checkbox', { name: /Indicar a la IA/ })).toBeChecked()
    await dialog.getByRole('button', {
      name: `Seleccionar imagen de ${firstCharacter.name} [seria][capa]`
    }).click()
    await dialog.getByRole('button', { name: 'Cambiar' }).click()
    await expect(page.getByTestId('pending-image-instructions')).toContainText('[seria][capa]')
    expect((await data.get<Story>('stories', story.id)).pendingImageInstructions).toEqual([
      { characterId: firstCharacter.id, imageId: requested.id, tags: ['seria', 'capa'] }
    ])

    await page.reload()
    await expect(page.getByTestId('pending-image-instructions')).toContainText('[seria][capa]')
    await page.getByTestId('continue-button').click()
    await expect(page.getByRole('alert')).toContainText('fallo visual simulado')
    expect((await data.get<Story>('stories', story.id)).pendingImageInstructions).toHaveLength(1)

    await page.evaluate(() => {
      ;(window as Window & { __chromeFail?: boolean }).__chromeFail = false
    })
    await page.getByTestId('continue-button').click()
    await expect(page.getByText('Estoy lista.', { exact: true })).toBeVisible()
    expect((await data.get<Story>('stories', story.id)).pendingImageInstructions).toEqual([])
    const prompts = await page.evaluate(() =>
      (window as Window & { __chromePrompts?: Array<Array<{ role: string; content: string }>> }).__chromePrompts
    )
    expect(prompts).toHaveLength(2)
    for (const prompt of prompts ?? []) {
      expect(prompt.at(-1)?.role).toBe('user')
      expect(prompt.at(-1)?.content).toContain('INDICACIÓN VISUAL PARA ESTA RESPUESTA')
      expect(prompt.at(-1)?.content).toContain(`${firstCharacter.name}: [seria][capa]`)
      expect(prompt.at(-1)?.content).toContain('salvo que la historia requiera cambiar su aspecto o ropa')
      expect(prompt[0]?.content).not.toContain('INDICACIÓN VISUAL PARA ESTA RESPUESTA')
    }

    await page.getByTestId('continue-button').click()
    await expect(page.getByText('Estoy lista.', { exact: true })).toHaveCount(2)
    const nextPrompt = await page.evaluate(() =>
      (window as Window & { __chromePrompts?: Array<Array<{ content: string }>> }).__chromePrompts?.at(-1)
    )
    expect(JSON.stringify(nextPrompt)).not.toContain('INDICACIÓN VISUAL PARA ESTA RESPUESTA')
  })

  for (const mode of ['normal', 'continue', 'auto'] as const) {
    test(`envía preferencia de imagen a LM Studio una sola vez con ${mode}`, async ({ page, data }) => {
      const character = await data.createCharacter({ name: data.unique('Alicia') })
      const neutral = await data.createImage(character, ['neutral'])
      await data.createImage(character, ['seria', 'capa'])
      const story = await data.createStory({ characters: [character] })
      const alias = data.unique('Lia')
      story.characterCustomizations[0]!.name = alias
      const updated = await page.request.put(`/api/data/stories/${story.id}?scope=normal`, { data: story })
      expect(updated.ok()).toBe(true)
      await data.createMessage({
        story,
        role: 'assistant',
        raw: `${alias} [neutral]: Imagen inicial.`,
        segments: [{ type: 'dialogue', characterId: character.id, tag: 'neutral', tags: ['neutral'], imageId: neutral.id, text: 'Imagen inicial.' }]
      })
      await data.patchSettings({
        mockMode: false,
        model: 'test-model',
        useChromeLlm: false,
        privateUseChromeLlm: null,
        responseSpeed: 'instant',
        historyBudget: 100_000,
        userName: 'Vera'
      })
      const requests: Array<{ messages: Array<{ role: string; content: string }> }> = []
      await page.route('**/api/llm/chat', async (route) => {
        requests.push(route.request().postDataJSON())
        await route.fulfill({ json: { content: `${alias} [seria][capa]: Respuesta ${requests.length}.`, finishReason: 'stop' } })
      })

      await page.goto(`/stories/${story.id}`)
      await page.getByRole('button', { name: new RegExp(`Cambiar ${alias}`) }).click()
      const dialog = page.getByRole('dialog', { name: 'Cambiar imagen' })
      await dialog.getByRole('button', { name: `Seleccionar imagen de ${alias} [seria][capa]` }).dblclick()
      await expect(page.getByTestId('pending-image-instructions')).toContainText('[seria][capa]')

      if (mode === 'normal') {
        await page.getByPlaceholder('Escribe lo que haces o dices…').fill('Sigo adelante.')
        await page.getByRole('button', { name: 'Enviar', exact: true }).click()
      } else {
        await page.getByTestId(mode === 'continue' ? 'continue-button' : 'auto-button').click()
      }
      await expect(page.getByText('Respuesta 1.', { exact: true })).toBeVisible()
      await expect(page.getByTestId('pending-image-instructions')).toHaveCount(0)
      expect(requests).toHaveLength(1)
      const payload = requests[0]!.messages
      expect(payload.at(-1)?.role).toBe('user')
      expect(payload.at(-1)?.content).toContain(`${alias}: [seria][capa]`)
      expect(payload.at(-1)?.content).toContain('prefiero estas etiquetas visuales')
      expect(payload.at(-1)?.content).toContain('salvo que la historia requiera cambiar su aspecto o ropa')
      expect(payload.at(-1)?.content).toContain('no es una instrucción permanente')
      expect(payload[0]?.content).not.toContain('INDICACIÓN VISUAL PARA ESTA RESPUESTA')
      if (mode === 'normal') expect(payload.at(-2)?.content).toBe('Vera: Sigo adelante.')
      expect((await data.get<Story>('stories', story.id)).pendingImageInstructions).toEqual([])
      const stored = await data.list<Message>('messages', 'normal', { storyId: story.id })
      expect(stored.some((message) => message.raw.includes('INDICACIÓN VISUAL'))).toBe(false)

      await page.getByTestId('continue-button').click()
      await expect(page.getByText('Respuesta 2.', { exact: true })).toBeVisible()
      expect(requests).toHaveLength(2)
      expect(JSON.stringify(requests[1]!.messages)).not.toContain('INDICACIÓN VISUAL PARA ESTA RESPUESTA')
    })
  }
})
