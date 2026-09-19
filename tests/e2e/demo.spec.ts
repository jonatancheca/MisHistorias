import type { Background } from '../../shared/types'
import { test, expect } from './fixtures'

test.describe('modo demo', () => {
  test('filtra el catálogo, mantiene la URL y vuelve a público al salir o recargar', async ({ page, data }) => {
    const visible = await data.createCharacter({
      name: data.unique('Visible-demo'),
      visibleInDemo: true,
      scope: 'private'
    })
    const hidden = await data.createCharacter({
      name: data.unique('Oculto-demo'),
      scope: 'private'
    })

    await page.goto('/characters')
    await page.locator('main').press('Control+Alt+d')
    await expect(page.locator('html')).toHaveClass(/demo-scope/)
    await expect(page).toHaveURL('/characters')
    await expect(page.getByText(visible.name, { exact: true })).toBeVisible()
    await expect(page.getByText(hidden.name, { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Salir del modo privado' })).toHaveCount(0)
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 800 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    await page.setViewportSize({ width: 1280, height: 800 })

    await page.keyboard.press('Control+Alt+d')
    await expect(page.locator('html')).not.toHaveClass(/demo-scope/)
    await expect(page).toHaveURL('/characters')

    await page.goto('/settings')
    await page.getByLabel('Nombre', { exact: true }).focus()
    await page.keyboard.press('Control+Alt+d')
    await expect(page.locator('html')).not.toHaveClass(/demo-scope/)

    await page.locator('main').press('Control+Alt+d')
    await expect(page.locator('html')).toHaveClass(/demo-scope/)
    await page.reload()
    await expect(page.locator('html')).not.toHaveClass(/demo-scope/)

    await page.goto(`/characters/${hidden.id}`)
    await page.locator('main').press('Control+Alt+d')
    await expect(page).toHaveURL('/characters')
    await expect(page.locator('html')).toHaveClass(/demo-scope/)
  })

  test('limita las etiquetas disponibles a los personajes demo', async ({ page, data }) => {
    const visibleCharacterTag = data.unique('rasgo-visible')
    const hiddenCharacterTag = data.unique('rasgo-privado')
    const visibleImageTag = data.unique('imagen-visible')
    const hiddenImageTag = data.unique('imagen-privada')
    const visible = await data.createCharacter({
      name: data.unique('Visible-etiquetas'),
      tags: [visibleCharacterTag],
      visibleInDemo: true,
      scope: 'private'
    })
    const hidden = await data.createCharacter({
      name: data.unique('Oculto-etiquetas'),
      tags: [hiddenCharacterTag],
      scope: 'private'
    })
    await data.createImage(visible, [visibleImageTag], 'private')
    await data.createImage(hidden, [hiddenImageTag], 'private')

    await page.goto(`/characters/${visible.id}`)
    await page.locator('main').press('Control+Alt+d')
    await expect(page.locator('html')).toHaveClass(/demo-scope/)

    await expect(page.getByRole('button', { name: visibleCharacterTag, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: hiddenCharacterTag, exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: visibleImageTag, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: hiddenImageTag, exact: true })).toHaveCount(0)

    await page.getByRole('link', { name: 'Historias', exact: true }).click()
    await page.getByRole('link', { name: 'Nueva historia', exact: true }).click()
    await page.getByRole('button', { name: `Añadir ${visible.name} al elenco` }).click()
    await page.getByRole('button', { name: `Editar ${visible.name}` }).click()
    const characterDialog = page.getByRole('dialog', { name: `Editar ${visible.name}` })
    await expect(characterDialog.getByRole('button', {
      name: visibleCharacterTag,
      exact: true
    })).toBeVisible()
    await expect(characterDialog.getByRole('button', {
      name: hiddenCharacterTag,
      exact: true
    })).toHaveCount(0)
  })

  test('muestra recursos archivados marcados y dependencias contextuales de una historia demo', async ({ page, data }) => {
    const archivedVisible = await data.createCharacter({
      name: data.unique('Archivado-visible'),
      archived: true,
      visibleInDemo: true,
      scope: 'private'
    })
    const contextualCharacter = await data.createCharacter({
      name: data.unique('Contextual-archivado'),
      archived: true,
      scope: 'private'
    })
    const contextualBackground = await data.createBackground({
      tags: [data.unique('contextual-fondo')],
      scope: 'private'
    })
    const story = await data.createStory({
      title: data.unique('Historia-demo'),
      characters: [contextualCharacter],
      background: contextualBackground,
      archived: false,
      visibleInDemo: true,
      scope: 'private'
    })

    await page.goto('/characters')
    await page.locator('main').press('Control+Alt+d')
    await page.getByRole('button', { name: 'Ver archivados' }).click()
    await expect(page.getByText(archivedVisible.name, { exact: true })).toBeVisible()
    await expect(page.getByText(contextualCharacter.name, { exact: true })).toHaveCount(0)

    await page.getByRole('link', { name: 'Historias', exact: true }).click()
    await page.getByRole('link', { name: story.title }).evaluate((element: HTMLAnchorElement) => element.click())
    await expect(page.getByText(`Fondo inicial · ${contextualBackground.tags[0]}`, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Ajustes de la historia' }).click()
    const form = page.getByRole('dialog', { name: 'Ajustes de la historia' })
    await form.getByRole('button', { name: `Editar ${contextualCharacter.name}` }).click()
    await expect(page.getByRole('dialog', { name: `Editar ${contextualCharacter.name}` })
      .getByLabel('Nombre en esta historia')).toHaveValue(contextualCharacter.name)
    await page.getByRole('dialog', { name: `Editar ${contextualCharacter.name}` })
      .getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.getByRole('checkbox', { name: /Visible en modo demo/ })).toHaveCount(0)
  })

  test('exporta solo lo visible y las dependencias necesarias', async ({ page, data }) => {
    const markedCharacter = await data.createCharacter({
      name: data.unique('Marcado'),
      visibleInDemo: true,
      scope: 'private'
    })
    const contextualCharacter = await data.createCharacter({
      name: data.unique('Dependencia'),
      scope: 'private'
    })
    const hiddenCharacter = await data.createCharacter({
      name: data.unique('Privado'),
      scope: 'private'
    })
    const markedBackground = await data.createBackground({
      tags: [data.unique('marcado')],
      scope: 'private'
    })
    const contextualBackground = await data.createBackground({
      tags: [data.unique('dependencia')],
      scope: 'private'
    })
    const hiddenBackground = await data.createBackground({
      tags: [data.unique('privado')],
      scope: 'private'
    })
    const visibleStory = await data.createStory({
      title: data.unique('Visible'),
      characters: [contextualCharacter],
      background: contextualBackground,
      visibleInDemo: true,
      scope: 'private'
    })
    const rememberedPrivatePrompt = data.unique('Prompt-privado-recordado')
    const rememberResponse = await page.request.put(
      `/api/data/stories/${visibleStory.id}?scope=private`,
      {
        data: {
          ...visibleStory,
          characterCustomizations: [
            ...visibleStory.characterCustomizations,
            {
              characterId: hiddenCharacter.id,
              name: hiddenCharacter.name,
              color: hiddenCharacter.color,
              prompt: rememberedPrivatePrompt,
              tags: [...hiddenCharacter.tags]
            }
          ]
        }
      }
    )
    expect(rememberResponse.ok()).toBe(true)
    await data.createStory({
      title: data.unique('Oculta'),
      characters: [hiddenCharacter],
      background: hiddenBackground,
      scope: 'private'
    })
    const contextualSound = await data.createSound(
      contextualCharacter,
      [data.unique('sonido-contextual')],
      'private'
    )
    const markedSound = await data.createSound(
      markedCharacter,
      [data.unique('sonido-marcado')],
      'private'
    )
    const hiddenSound = await data.createSound(
      hiddenCharacter,
      [data.unique('sonido-privado')],
      'private'
    )
    const standaloneSound = await data.createSound(null, [data.unique('sonido-suelto')], 'private')
    await data.createMessage({
      story: visibleStory,
      role: 'assistant',
      raw: [
        `Sonido [${contextualSound.tags[0]}]: suena`,
        `Sonido [${hiddenSound.tags[0]}]: secreto`,
        `Sonido [${standaloneSound.tags[0]}]: suelto`
      ].join('\n'),
      scope: 'private'
    })

    await page.goto('/settings')
    const privateTrigger = page.getByRole('button', { name: 'Activar modo privado' })
    expect(await privateTrigger.evaluate((element) =>
      element.previousElementSibling?.textContent?.includes('Modo oscuro') === true
    )).toBe(true)
    await privateTrigger.click()
    await privateTrigger.click()
    await privateTrigger.click()
    await expect(page.locator('html')).toHaveClass(/private-scope/)
    await page.getByRole('link', { name: 'Fondos', exact: true }).click()
    const markedCard = page.locator('li').filter({ hasText: markedBackground.tags[0]! })
    await markedCard.getByRole('checkbox', { name: 'Visible en modo demo' }).check()
    await expect.poll(async () =>
      (await data.get<Background>('backgrounds', markedBackground.id, 'private')).visibleInDemo
    ).toBe(true)
    await page.getByRole('link', { name: 'Ajustes', exact: true }).click()
    const demoTrigger = page.getByRole('button', { name: 'Alternar modo demo' })
    expect(await demoTrigger.evaluate((element) =>
      element.previousElementSibling?.textContent?.includes('Exportar JSON') === true
    )).toBe(true)
    await demoTrigger.click()
    await demoTrigger.click()
    await demoTrigger.click()
    await expect(page.locator('html')).toHaveClass(/demo-scope/)
    await expect(demoTrigger).toBeEnabled()
    await page.getByRole('link', { name: 'Fondos', exact: true }).click()
    await expect(page.getByText(markedBackground.tags[0]!, { exact: true })).toBeVisible()
    await expect(page.getByText(contextualBackground.tags[0]!, { exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'Ajustes', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Alternar modo demo' })).toBeEnabled()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exportar JSON' }).click()
    const download = await downloadPromise
    const stream = await download.createReadStream()
    let raw = ''
    for await (const chunk of stream) raw += chunk.toString()
    const bundle = JSON.parse(raw) as {
      version: number
      characters: Array<{ id: string }>
      backgrounds: Array<{ id: string }>
      sounds: Array<{ id: string }>
      stories: Array<{
        title: string
        messages: Array<{ raw: string }>
        characterCustomizations: Array<{ characterId: string; prompt: string }>
      }>
      swarmPrompts: unknown[]
    }

    expect(bundle.version).toBe(23)
    const characterIds = bundle.characters.map((item) => item.id)
    expect(characterIds).toEqual(expect.arrayContaining([markedCharacter.id, contextualCharacter.id]))
    expect(characterIds).not.toContain(hiddenCharacter.id)
    const backgroundIds = bundle.backgrounds.map((item) => item.id)
    expect(backgroundIds).toEqual(expect.arrayContaining([markedBackground.id, contextualBackground.id]))
    expect(backgroundIds).not.toContain(hiddenBackground.id)
    const soundIds = bundle.sounds.map((item) => item.id)
    expect(soundIds).toEqual(expect.arrayContaining([contextualSound.id, markedSound.id]))
    expect(soundIds).not.toContain(hiddenSound.id)
    expect(soundIds).not.toContain(standaloneSound.id)
    const exportedStory = bundle.stories.find((item) => item.title === visibleStory.title)
    expect(exportedStory).toBeDefined()
    expect(exportedStory?.messages[0]?.raw).toContain(contextualSound.tags[0])
    expect(exportedStory?.messages[0]?.raw).not.toContain(hiddenSound.tags[0])
    expect(exportedStory?.messages[0]?.raw).not.toContain(standaloneSound.tags[0])
    expect(exportedStory?.characterCustomizations.some(
      (customization) => customization.characterId === hiddenCharacter.id ||
        customization.prompt === rememberedPrivatePrompt
    )).toBe(false)
    expect(bundle.swarmPrompts).toEqual([])
  })
})
