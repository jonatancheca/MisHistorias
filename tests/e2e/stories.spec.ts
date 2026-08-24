import type { CharacterImage, LlmDebugTrace, Message, Story } from '../../shared/types'
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
    const storyCharacterName = data.unique('Nombre-historia')

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
    await page.getByLabel('Prompt de preparación').selectOption(preset.id)
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
      presetId: preset.id
    })
    expect(stored.characterCustomizations[0]?.prompt).toBe(storyPrompt)
    expect(stored.characterCustomizations[0]?.name).toBe(storyCharacterName)
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
    await form.locator(`#story-settings-character-name-${character.id}`).fill(updatedCharacterName)
    await expect(form.getByRole('heading', {
      name: `${character.name} → ${updatedCharacterName}`
    })).toBeVisible()
    await form.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByRole('heading', { name: updatedTitle })).toBeVisible()
    await expect(page.getByText(updatedPremise)).toBeVisible()
    await expect.poll(async () => await data.get<Story>('stories', storyId)).toMatchObject({
      title: updatedTitle,
      premise: updatedPremise,
      characterCustomizations: [{ characterId: character.id, name: updatedCharacterName }]
    })
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
})

test.describe('chat', () => {
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
        messages: [{ role: 'user', content: 'Miro la escena.' }],
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
      await page.setViewportSize({ width, height: 760 })
      await page.goto(`/stories/${story.id}`)

      await expect(page.getByRole('button', { name: 'Ver datos de debug de la llamada LLM' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Editar mensaje' }).first()).toBeVisible()
      await expect(page.getByRole('button', { name: 'Borrar mensaje' }).first()).toBeVisible()
      await expect(page.getByRole('button', { name: 'Regenerar desde este mensaje' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Reenviar este mensaje' })).toBeVisible()

      const debugButton = page.getByRole('button', { name: 'Ver datos de debug de la llamada LLM' })
      await debugButton.click()
      await expect(page.getByRole('dialog', { name: 'Debug LLM' })).toBeVisible()
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

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/stories/${story.id}`)
    const desktopCaption = page.getByRole('button', { name: `Ver tags LLM de ${secondCharacter.name}` })
    const desktopFigure = desktopCaption.locator('xpath=../..')
    await expect(desktopCaption.locator('..')).toHaveCSS('opacity', '0')
    await desktopFigure.hover()
    await expect(desktopCaption.locator('..')).toHaveCSS('opacity', '1')
    await expect(desktopCaption).toContainText('LLM: seria · capa')
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
    const { story } = await createStoryFixture(data, true)
    await data.patchSettings({ mockMode: true, responseSpeed: 'slow' })

    await page.goto(`/stories/${story.id}`)
    await page.evaluate(() => {
      const seen: string[] = []
      Object.assign(window, { __visualFrameTexts: seen })
      new MutationObserver(() => {
        const text = document.querySelector('[data-testid="visual-novel-frame"]')?.textContent ?? ''
        if (text.trim()) seen.push(text)
      }).observe(document.body, { childList: true, characterData: true, subtree: true })
    })

    await page.getByTestId('continue-button').click()
    await expect(page.getByRole('button', { name: 'Parar', exact: true })).toBeVisible()
    await page.waitForTimeout(5_000)
    await page.getByRole('button', { name: 'Parar', exact: true }).click()

    const seen = await page.evaluate(() =>
      (window as typeof window & { __visualFrameTexts?: string[] }).__visualFrameTexts ?? []
    )
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
    const { story } = await createStoryFixture(data, true)
    await data.patchSettings({ mockMode: true, responseSpeed: 'slow' })

    await page.goto(`/stories/${story.id}`)
    await page.getByTestId('continue-button').click()
    const frame = page.getByTestId('visual-novel-frame')
    await expect.poll(async () => (await frame.innerText()).trim(), { timeout: 15_000 })
      .not.toBe('La historia aún no ha empezado.')
    const before = (await frame.innerText()).trim()

    await frame.click()
    const after = (await frame.innerText()).trim()
    expect(after.length).toBeGreaterThan(before.length + 5)
    await page.waitForTimeout(300)
    await expect(page.getByRole('button', { name: 'Parar', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Parar', exact: true }).click()
  })

  test('completa la intervención actual con flecha derecha antes de avanzar', async ({ page, data }) => {
    const { story } = await createStoryFixture(data, true)
    await data.patchSettings({
      mockMode: true,
      responseSpeed: 'slow',
      visualNovelManualAdvance: true
    })

    await page.goto(`/stories/${story.id}`)
    await page.getByTestId('continue-button').click()
    const frame = page.getByTestId('visual-novel-frame')
    await expect.poll(async () => (await frame.innerText()).trim(), { timeout: 15_000 })
      .not.toBe('La historia aún no ha empezado.')
    const before = (await frame.innerText()).trim()

    await page.keyboard.press('ArrowRight')
    const after = (await frame.innerText()).trim()
    expect(after.length).toBeGreaterThan(before.length + 5)
    await page.waitForTimeout(300)
    await expect(page.getByRole('button', { name: 'Parar', exact: true })).toBeVisible()
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

    await page.keyboard.press('Space')
    const completedText = (await frame.innerText()).trim()
    const completedIndex = Number((await counter.innerText()).split('/')[0]?.trim())
    await page.waitForTimeout(500)
    await expect(frame).toHaveText(completedText)

    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: ' ',
        repeat: true,
        bubbles: true
      }))
    })
    await expect(frame).toHaveText(completedText)

    const input = page.getByPlaceholder('Escribe lo que haces o dices…')
    await input.press('Enter')
    await expect(frame).toHaveText(completedText)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

    await page.keyboard.press('Enter')
    await expect.poll(async () =>
      Number((await counter.innerText()).split('/')[0]?.trim())
    ).toBeGreaterThan(completedIndex)
    const startedText = (await frame.innerText()).trim()
    await page.waitForTimeout(500)
    expect((await frame.innerText()).trim().length).toBeGreaterThan(startedText.length)

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
    await data.patchSettings({
      mockMode: true,
      responseSpeed: 'slow',
      visualNovelManualAdvance: true,
      userName: 'Vera'
    })

    await page.goto(`/stories/${story.id}`)
    await page.evaluate(() => {
      Math.random = () => 0
    })
    const frame = page.getByTestId('visual-novel-frame')
    const counter = page.getByTestId('visual-novel-counter')
    await expect(counter).toHaveText('1 / 1')
    await page.getByTestId('auto-button').click()

    await expect.poll(async () =>
      Number((await counter.innerText()).split('/')[0]?.trim())
    ).toBe(2)
    await expect(frame).not.toContainText('Frase anterior.')
    const firstStartedText = (await frame.innerText()).trim()
    await page.waitForTimeout(500)
    expect((await frame.innerText()).trim().length).toBeGreaterThan(firstStartedText.length)

    await page.keyboard.press('Space')
    await page.keyboard.press('Space')
    await expect.poll(async () =>
      Number((await counter.innerText()).split('/')[0]?.trim())
    ).toBe(3)
    await expect(frame).toContainText('Vera:')
    const protagonistStartedText = (await frame.innerText()).trim()
    await page.waitForTimeout(500)
    expect((await frame.innerText()).trim().length).toBeGreaterThan(protagonistStartedText.length)

    await page.getByRole('button', { name: 'Parar', exact: true }).click()
  })

  test('muestra el mensaje escrito aunque el avance manual esté activo', async ({ page, data }) => {
    const { story, character, image } = await createStoryFixture(data, true)
    await data.patchSettings({
      mockMode: true,
      responseSpeed: 'slow',
      visualNovelManualAdvance: true
    })
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
    await page.getByTestId('visual-novel-previous').click()
    await expect(page.getByTestId('visual-novel-frame')).toContainText('Mensaje anterior.')

    const submitted = data.unique('Nuevo-mensaje-manual')
    await page.getByPlaceholder('Escribe lo que haces o dices…').fill(submitted)
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(page.getByTestId('visual-novel-frame')).toContainText(submitted)
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
    await page.getByRole('button', { name: new RegExp(`Cambiar ${character.name}`) }).click()
    let dialog = page.getByRole('dialog', { name: 'Cambiar imagen' })
    await expect(dialog.getByLabel('Personaje para la imagen')).toHaveCount(0)
    await expect(dialog.getByText(`Personaje: ${character.name}`, { exact: true })).toBeVisible()
    await expect(dialog.getByText(`Personaje: ${otherCharacter.name}`, { exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('checkbox', { name: /Indicar a la IA/ })).toBeChecked()
    await dialog.getByRole('button', { name: 'Seleccionar imagen [seria][capa]' }).dblclick()
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
    await expect(page.getByRole('button', { name: `Ver tags LLM de ${character.name}` })).toContainText(
      `${character.name} · seria · capa`
    )

    await page.getByTestId('visual-mode-toggle').click()
    await page.getByRole('button', { name: `Cambiar imagen de ${character.name}` }).click()
    dialog = page.getByRole('dialog', { name: 'Cambiar imagen' })
    await dialog.getByRole('button', { name: 'Seleccionar imagen [feliz]' }).dblclick()
    await expect(dialog).toBeHidden()
    stored = await data.get<Message>('messages', message.id)
    expect(stored.segments[0]?.imageId).toBe(first.id)

    await page.reload()
    await expect(page.getByRole('button', { name: `Cambiar imagen de ${character.name}` })).toBeVisible()
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
    await dialog.getByRole('button', { name: 'Seleccionar imagen [seleccionada]' }).dblclick()

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
    await data.createImage(firstCharacter, ['neutral'])
    const requested = await data.createImage(firstCharacter, ['seria', 'capa'])
    await data.createImage(secondCharacter, ['alerta'])
    const preset = await data.createPreset()
    const story = await data.createStory({ characters: [firstCharacter, secondCharacter], preset })
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
    await page.getByTestId('pending-image-button').click()
    const dialog = page.getByRole('dialog', { name: 'Imagen para la próxima respuesta' })
    await dialog.getByLabel('Personaje para la imagen').selectOption(firstCharacter.id)
    await dialog.getByRole('button', { name: 'Seleccionar imagen [seria][capa]' }).click()
    await dialog.getByRole('button', { name: 'Preparar' }).click()
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
      (window as Window & { __chromePrompts?: Array<Array<{ content: string }>> }).__chromePrompts
    )
    expect(prompts?.at(-1)?.some((message) =>
      message.content.includes('INDICACIÓN VISUAL PARA ESTA RESPUESTA') &&
      message.content.includes(`${firstCharacter.name}: [seria][capa]`)
    )).toBe(true)
  })
})
