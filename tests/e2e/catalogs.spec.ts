import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import type { Locator, Page } from '@playwright/test'
import type { Background, Character, CharacterImage, Sound } from '../../shared/types'
import { createPng, expect, PNG_BYTES, test } from './fixtures'

async function characterZip(name: string, prompt = 'Prompt desde ZIP') {
  const zip = new JSZip()
  zip.file('character.json', JSON.stringify({
    version: 1,
    character: {
      name,
      prompt,
      tags: ['importado'],
      color: '#123456',
      imageGenerationPreset: 'Retrato'
    },
    images: [],
    sounds: []
  }))
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function uploadCharacterZip(page: import('@playwright/test').Page, buffer: Buffer) {
  await page.locator('input[type="file"][accept*="zip"]').setInputFiles({
    name: 'personaje.zip',
    mimeType: 'application/zip',
    buffer
  })
}

async function dragImageWithMouse(page: Page, source: Locator, target: Locator) {
  await target.scrollIntoViewIfNeeded()
  await source.scrollIntoViewIfNeeded()
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  expect(sourceBox).not.toBeNull()
  expect(targetBox).not.toBeNull()
  await page.mouse.move(
    sourceBox!.x + sourceBox!.width / 2,
    sourceBox!.y + sourceBox!.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(
    targetBox!.x + targetBox!.width / 2,
    targetBox!.y + targetBox!.height / 2,
    { steps: 8 }
  )
  await page.mouse.up()
}

async function dragImageWithTouchToBottom(page: Page, source: Locator) {
  await source.scrollIntoViewIfNeeded()
  const sourceBox = await source.boundingBox()
  expect(sourceBox).not.toBeNull()
  const start = {
    x: sourceBox!.x + sourceBox!.width / 2,
    y: sourceBox!.y + sourceBox!.height / 2
  }
  const end = {
    x: start.x,
    y: (page.viewportSize()?.height ?? 844) - 60
  }
  await source.dispatchEvent('pointerdown', {
    pointerId: 91,
    pointerType: 'touch',
    button: 0,
    clientX: start.x,
    clientY: start.y
  })
  await page.evaluate(({ x, y }) => {
    for (let step = 0; step < 160; step += 1) {
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerId: 91,
        pointerType: 'touch',
        clientX: x,
        clientY: y
      }))
    }
    const list = document.querySelector('[data-testid="character-image-card"]')?.parentElement
    const bounds = list?.getBoundingClientRect()
    const releaseY = bounds
      ? Math.max(bounds.top + 2, Math.min(y, bounds.bottom - 2))
      : y
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      pointerId: 91,
      pointerType: 'touch',
      clientX: x,
      clientY: releaseY
    }))
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      pointerId: 91,
      pointerType: 'touch',
      clientX: x,
      clientY: releaseY
    }))
  }, end)
}

test.describe('personajes', () => {
  test('muestra flecha hacia arriba en la acción de importar', async ({ page }) => {
    await page.goto('/characters')

    const importButton = page.getByRole('button', { name: 'Importar', exact: true })
    await expect(importButton).toBeVisible()
    await expect(importButton.locator('svg')).toHaveAttribute('aria-hidden', 'true')
    await expect(importButton.locator('path').first())
      .toHaveAttribute('d', 'M12 17V5m0 0-4 4m4-4 4 4')
  })

  test('conserva mensajes de error con acentos sin usar statusMessage', async ({ page }) => {
    const response = await page.request.get('/api/data/characters?scope=invalido')

    expect(response.status()).toBe(400)
    expect(await response.json()).toMatchObject({ message: 'Ámbito de datos no válido' })
  })

  test('crea personaje nuevo y persiste sus datos', async ({ page, data }) => {
    const name = data.unique('Clara')
    const prompt = data.unique('Prompt')
    const tag = data.unique('valiente')

    await page.goto('/characters/new')
    await page.getByLabel('Nombre').fill(name)
    await page.getByLabel('Prompt del personaje').fill(prompt)
    await page.getByLabel('Etiquetas del personaje').fill(tag)
    await page.getByLabel('Etiquetas del personaje').press('Enter')
    await page.getByRole('button', { name: 'Guardar' }).click()

    await expect(page).toHaveURL(/\/characters\/[^/]+$/)
    await expect(page.getByRole('heading', { name })).toBeVisible()
    const stored = (await data.list<Character>('characters')).find((item) => item.name === name)
    expect(stored).toMatchObject({ name, prompt, tags: [tag] })
  })

  test('genera prompt visual desde foto antes de guardar sin añadirla a la galería', async ({ page, data }) => {
    const name = data.unique('Referencia')
    await data.patchSettings({
      model: 'vision-test',
      useChromeLlm: true,
      characterReferencePrompt: 'Instrucción visual personalizada'
    })
    let received: Record<string, unknown> | null = null
    await page.route('**/api/llm/chat', async (route) => {
      received = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          content: '<think>omitido</think>Prompt: red-haired woman, green eyes, blue coat',
          finishReason: 'stop'
        })
      })
    })

    await page.goto('/characters/new')
    await expect(page.getByLabel('Prompt visual base')).toHaveCount(0)
    await page.getByTestId('character-swarm-toggle').click()
    await expect(page.getByTestId('character-swarm-generator')).toBeVisible()
    await page.locator('input[type=file][accept*="image/jpeg"]').setInputFiles({
      name: 'referencia.png', mimeType: 'image/png', buffer: PNG_BYTES
    })
    await expect(page.getByRole('img', { name: 'Vista previa de foto de referencia' })).toBeVisible()
    await page.getByRole('button', { name: 'Generar prompt desde foto' }).click()
    await expect(page.getByLabel('Prompt visual base')).toHaveValue(
      'red-haired woman, green eyes, blue coat'
    )
    const messages = received?.messages as Array<{ content: unknown }>
    expect(received?.model).toBe('vision-test')
    expect(messages[0]?.content).toBe('Instrucción visual personalizada')
    expect(messages[1]?.content).toEqual([
      {
        type: 'text',
        text: 'Create the reusable character prompt for ComfyUI from this reference photo.'
      },
      { type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) } }
    ])
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }

    await page.getByLabel('Nombre').fill(name)
    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect(page).toHaveURL(/\/characters\/[^/]+$/)
    const stored = (await data.list<Character>('characters')).find((item) => item.name === name)!
    expect(stored.imageGenerationPromptPrefix).toBe('red-haired woman, green eyes, blue coat')
    expect(await data.list<CharacterImage>('images', 'normal', { characterId: stored.id })).toHaveLength(0)
  })

  test('reemplaza prompt visual al editar y conserva anterior si falla', async ({ page, data }) => {
    await data.patchSettings({ model: 'vision-test' })
    const character = await data.createCharacter({ imageGenerationPromptPrefix: 'original visual' })
    let shouldFail = true
    await page.route('**/api/llm/chat', async (route) => {
      if (shouldFail) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Fallo visual' })
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: 'updated visual identity', finishReason: 'stop' })
      })
    })

    await page.goto(`/characters/${character.id}`)
    await expect(page.getByLabel('Prompt visual base')).toHaveCount(0)
    await page.getByTestId('character-swarm-toggle').click()
    await expect(page.getByTestId('character-swarm-generator')).toBeVisible()
    await page.locator('input[type=file][accept*="image/jpeg"]').setInputFiles({
      name: 'referencia.webp', mimeType: 'image/webp', buffer: PNG_BYTES
    })
    await page.getByRole('button', { name: 'Generar prompt desde foto' }).click()
    await expect(page.getByRole('alert')).toContainText('Fallo visual')
    await expect(page.getByLabel('Prompt visual base')).toHaveValue('original visual')

    shouldFail = false
    await page.getByRole('button', { name: 'Generar prompt desde foto' }).click()
    await expect(page.getByLabel('Prompt visual base')).toHaveValue('updated visual identity')
    await expect(page.getByText('Guardado', { exact: true })).toBeVisible()
    await expect.poll(async () => (
      await data.get<Character>('characters', character.id)
    ).imageGenerationPromptPrefix).toBe('updated visual identity')
  })

  test('autoguarda edición de personaje existente', async ({ page, data }) => {
    const character = await data.createCharacter()
    const updatedPrompt = data.unique('Prompt-editado')

    await page.goto(`/characters/${character.id}`)
    await page.getByLabel('Prompt del personaje').fill(updatedPrompt)
    await expect(page.getByText('Guardado', { exact: true })).toBeVisible()

    await expect.poll(async () => (await data.get<Character>('characters', character.id)).prompt)
      .toBe(updatedPrompt)
  })

  test('muestra visibilidad demo como toggle y badge en modo privado', async ({ page, data }) => {
    const character = await data.createCharacter({
      name: data.unique('Demo-visible'),
      visibleInDemo: false,
      scope: 'private'
    })
    await data.createImage(character, ['retrato'], 'private')

    await page.goto('/settings')
    const privateTrigger = page.getByRole('button', { name: 'Activar modo privado', exact: true })
    await privateTrigger.click()
    await privateTrigger.click()
    await privateTrigger.click()
    await page.getByRole('link', { name: 'Personajes', exact: true }).click()
    await page.getByRole('link', { name: character.name, exact: true }).click()

    const demoToggle = page.getByRole('switch', { name: 'Visible en demo' })
    const backLink = page.getByRole('link', { name: 'Volver' })
    await expect(demoToggle).not.toBeChecked()
    await expect(backLink).toBeVisible()
    const headerLayout = await page.locator('header').first().evaluate((header) => {
      const toggle = header.querySelector('[role="switch"]')!.closest('label')!.getBoundingClientRect()
      const back = header.querySelector('a')!.getBoundingClientRect()
      return { toggleRight: toggle.right, backLeft: back.left }
    })
    expect(headerLayout.toggleRight).toBeLessThanOrEqual(headerLayout.backLeft)

    await page.getByText('Visible en demo', { exact: true }).click()
    await expect(demoToggle).toBeChecked()
    await expect(page.getByText('Guardado', { exact: true })).toBeVisible()
    await expect.poll(async () => (
      await data.get<Character>('characters', character.id, 'private')
    ).visibleInDemo).toBe(true)

    await backLink.click()
    const card = page.locator('li').filter({ hasText: character.name })
    const demoBadge = card.getByText('Visible en demo', { exact: true })
    await expect(demoBadge).toBeVisible()
    await expect(card.getByText('1 imágenes', { exact: true })).toHaveCount(0)

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await card.getByRole('link', { name: character.name, exact: true }).click()
      await expect(page.getByRole('switch', { name: 'Visible en demo' })).toBeChecked()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await page.getByRole('link', { name: 'Volver' }).click()
    }
  })

  test('previsualiza una imagen y prioriza añadir originales', async ({ page, data }) => {
    const character = await data.createCharacter()
    const singleTag = data.unique('subida-individual')
    const batchTag = data.unique('subida-lote')
    await page.goto(`/characters/${character.id}`)
    const upload = page.locator('input[type="file"][accept="image/*"]')

    await expect(page.getByLabel('Etiquetas', { exact: true })).toHaveCount(0)

    await upload.setInputFiles({ name: 'una.png', mimeType: 'image/png', buffer: PNG_BYTES })
    const preview = page.getByRole('dialog', { name: 'Añadir imagen' })
    await expect(preview.getByRole('img', { name: 'Vista previa de imagen' })).toBeVisible()
    const add = preview.getByRole('button', { name: 'Añadir', exact: true })
    await expect(add).toBeFocused()
    expect(await add.getAttribute('class')).toContain('btn-primary')
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 700 })
      const layout = await preview.locator('section').evaluate((section) => ({
        clientWidth: section.clientWidth,
        scrollWidth: section.scrollWidth,
        pageScrollWidth: document.documentElement.scrollWidth
      }))
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)
      expect(layout.pageScrollWidth).toBeLessThanOrEqual(width)
    }
    await preview.getByRole('button', { name: 'Recortar', exact: true }).click()

    const crop = page.getByRole('dialog', { name: 'Recortar imagen' })
    await expect(crop.getByRole('button', { name: 'Guardar recorte' })).toBeVisible()
    await crop.getByRole('button', { name: 'Usar original' }).click()
    await expect(page.getByRole('status').filter({ hasText: '1 imagen añadida' })).toBeVisible()
    const singleTagsDialog = page.getByRole('dialog', { name: 'Etiquetas de la imagen subida' })
    await expect(singleTagsDialog).toBeVisible()
    expect(await data.list<CharacterImage>('images', 'normal', { characterId: character.id }))
      .toMatchObject([{ tags: ['neutral'], isDefault: true }])
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 700 })
      const layout = await singleTagsDialog.evaluate((section) => ({
        clientWidth: section.clientWidth,
        scrollWidth: section.scrollWidth,
        pageScrollWidth: document.documentElement.scrollWidth
      }))
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)
      expect(layout.pageScrollWidth).toBeLessThanOrEqual(width)
    }
    await singleTagsDialog.getByLabel('Etiquetas', { exact: true }).fill(singleTag)
    await singleTagsDialog.getByLabel('Etiquetas', { exact: true }).press('Enter')
    await singleTagsDialog.getByRole('button', { name: 'Guardar etiquetas' }).click()
    await expect.poll(async () => (
      await data.list<CharacterImage>('images', 'normal', { characterId: character.id })
    )[0]?.tags).toEqual([singleTag])

    await upload.setInputFiles([
      { name: 'dos.png', mimeType: 'image/png', buffer: PNG_BYTES },
      { name: 'tres.png', mimeType: 'image/png', buffer: PNG_BYTES }
    ])
    const batch = page.getByRole('dialog', { name: 'Añadir 2 imágenes' })
    const originals = batch.getByRole('button', { name: 'Usar originales' })
    await expect(originals).toBeFocused()
    expect(await originals.getAttribute('class')).toContain('btn-primary')
    await originals.click()
    await expect.poll(async () => (
      await data.list<CharacterImage>('images', 'normal', { characterId: character.id })
    ).length).toBe(3)
    const batchTagsDialog = page.getByRole('dialog', { name: 'Etiquetas de las 2 imágenes subidas' })
    await expect(batchTagsDialog).toContainText('Las etiquetas se aplicarán a todas')
    await batchTagsDialog.getByLabel('Etiquetas', { exact: true }).fill(batchTag)
    await batchTagsDialog.getByLabel('Etiquetas', { exact: true }).press('Enter')
    await batchTagsDialog.getByRole('button', { name: 'Guardar etiquetas' }).click()
    await expect.poll(async () => (
      await data.list<CharacterImage>('images', 'normal', { characterId: character.id })
    ).map((image) => image.tags)).toEqual([[singleTag], [batchTag], [batchTag]])
    expect((await data.list<CharacterImage>('images', 'normal', { characterId: character.id }))
      .filter((image) => image.isDefault)).toHaveLength(1)
  })

  test('reordena imágenes con ratón y touch, persiste el orden y conserva la predeterminada', async ({ page, data }) => {
    const character = await data.createCharacter()
    const first = await data.createImage(character, ['primera'])
    const second = await data.createImage(character, ['segunda'])
    const third = await data.createImage(character, ['tercera'])
    await page.setViewportSize({ width: 1280, height: 1100 })
    await page.goto(`/characters/${character.id}`)

    let cards = page.getByTestId('character-image-card')
    await dragImageWithMouse(
      page,
      cards.nth(0).getByTestId('character-image-drag-handle'),
      cards.nth(2)
    )
    await expect.poll(async () => (
      await data.list<CharacterImage>('images', 'normal', { characterId: character.id })
    ).map((image) => image.id)).toEqual([second.id, third.id, first.id])
    expect((await data.get<CharacterImage>('images', third.id)).isDefault).toBe(true)
    await expect(page.getByText('Orden guardado', { exact: true })).toHaveCount(0)

    await page.reload()
    cards = page.getByTestId('character-image-card')
    await expect(cards).toHaveCount(3)
    await expect(cards.nth(0)).toHaveAttribute('data-character-image-id', second.id)
    await expect(cards.nth(2)).toHaveAttribute('data-character-image-id', first.id)

    await page.setViewportSize({ width: 390, height: 844 })
    await dragImageWithTouchToBottom(
      page,
      cards.nth(0).getByTestId('character-image-drag-handle')
    )
    await expect.poll(async () => (
      await data.list<CharacterImage>('images', 'normal', { characterId: character.id })
    ).map((image) => image.id)).toEqual([third.id, first.id, second.id])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

    await cards.nth(0).getByRole('button', { name: 'Ampliar imagen' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')

    await cards.nth(0).getByRole('button', { name: 'Borrar', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Borrar' }).click()
    await expect.poll(async () => (
      await data.list<CharacterImage>('images', 'normal', { characterId: character.id })
    ).map((image) => ({ id: image.id, isDefault: image.isDefault }))).toEqual([
      { id: first.id, isDefault: true },
      { id: second.id, isDefault: false }
    ])

    const appended = await data.createImage(character, ['última'])
    await page.reload()
    cards = page.getByTestId('character-image-card')
    await expect(cards.last()).toHaveAttribute('data-character-image-id', appended.id)
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }

    await page.goto('/characters')
    const carousel = page.getByTestId('character-image-carousel').filter({
      has: page.locator(`[data-character-image-id="${first.id}"]`)
    })
    await expect(carousel.locator('[data-character-image-id]').first())
      .toHaveAttribute('data-character-image-id', first.id)
  })

  test('restaura el orden y solo muestra error cuando falla el guardado', async ({ page, data }) => {
    const character = await data.createCharacter()
    const first = await data.createImage(character, ['primera-error'])
    const second = await data.createImage(character, ['segunda-error'])
    let reorderRequests = 0
    await page.route('**/api/data/**', async (route) => {
      if (new URL(route.request().url()).pathname.endsWith('/images/reorder')) {
        reorderRequests += 1
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Fallo simulado' })
        })
        return
      }
      await route.continue()
    })
    await page.setViewportSize({ width: 900, height: 900 })
    await page.goto(`/characters/${character.id}`)

    const cards = page.getByTestId('character-image-card')
    await dragImageWithMouse(
      page,
      cards.nth(0).getByTestId('character-image-drag-handle'),
      cards.nth(1)
    )
    await expect.poll(() => reorderRequests).toBe(1)
    await expect(page.getByRole('alert')).toHaveText('No se pudo guardar el orden de las imágenes.')
    await expect(cards.nth(0)).toHaveAttribute('data-character-image-id', first.id)
    await expect(cards.nth(1)).toHaveAttribute('data-character-image-id', second.id)
    expect((await data.list<CharacterImage>('images', 'normal', { characterId: character.id }))
      .map((image) => image.id)).toEqual([first.id, second.id])
    await expect(page.getByText('Orden guardado', { exact: true })).toHaveCount(0)
  })

  test('recorta imágenes guardadas y restaura siempre la primera original', async ({ page, data }) => {
    const character = await data.createCharacter()
    await page.goto(`/characters/${character.id}`)
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
      name: 'original.png', mimeType: 'image/png', buffer: createPng(128, 96)
    })
    await page.getByRole('dialog', { name: 'Añadir imagen' }).getByRole('button', { name: 'Añadir', exact: true }).click()
    await page.getByRole('dialog', { name: 'Etiquetas de la imagen subida' })
      .getByRole('button', { name: 'Omitir' }).click()
    const card = page.getByTestId('character-image-card')
    await expect(card).toHaveCount(1)
    const image = (await data.list<CharacterImage>('images', 'normal', { characterId: character.id }))[0]!
    const contentUrl = `/api/data/images/${image.id}/content?scope=normal`
    const original = await (await page.request.get(contentUrl)).body()
    const originalUrl = `/api/data/images/${image.id}/original?scope=normal`
    const preview = card.locator('img').first()
    await expect(preview).toHaveJSProperty('naturalWidth', 128)

    await card.getByRole('button', { name: 'Recortar', exact: true }).click()
    await page.getByRole('dialog', { name: 'Recortar imagen' }).getByRole('button', { name: 'Cancelar' }).click()
    expect(await (await page.request.get(contentUrl)).body()).toEqual(original)
    expect((await data.get<CharacterImage>('images', image.id)).hasOriginal).toBe(false)

    let previousWidth = 128
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 760 })
      await card.getByRole('button', { name: 'Recortar', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Recortar imagen' })
      const save = dialog.getByRole('button', { name: 'Guardar recorte' })
      await expect(save).toBeEnabled()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await save.click()
      await expect(dialog).toHaveCount(0)
      await expect.poll(() => preview.evaluate((image) => (image as HTMLImageElement).naturalWidth))
        .toBeLessThan(previousWidth)
      const croppedWidth = await preview.evaluate((image) => (image as HTMLImageElement).naturalWidth)
      expect(croppedWidth).toBeGreaterThan(0)
      previousWidth = croppedWidth
      expect(await (await page.request.get(contentUrl)).body()).not.toEqual(original)
      expect(await (await page.request.get(originalUrl)).body()).toEqual(original)
      expect((await data.get<CharacterImage>('images', image.id)).hasOriginal).toBe(true)
      await page.reload()
      await expect(card.getByRole('button', { name: 'Restaurar original' })).toBeVisible()
      await expect(preview).toHaveJSProperty('naturalWidth', croppedWidth)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }
    await card.getByRole('button', { name: 'Restaurar original' }).click()
    await expect(preview).toHaveJSProperty('naturalWidth', 128)
    expect(await (await page.request.get(contentUrl)).body()).toEqual(original)
    await page.reload()
    await expect(preview).toHaveJSProperty('naturalWidth', 128)
    expect(await data.list<CharacterImage>('images', 'normal', { characterId: character.id })).toHaveLength(1)

    await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
      name: 'recorte-inicial.png', mimeType: 'image/png', buffer: createPng(128, 96)
    })
    await page.getByRole('dialog', { name: 'Añadir imagen' }).getByRole('button', { name: 'Recortar', exact: true }).click()
    await page.getByRole('dialog', { name: 'Recortar imagen' }).getByRole('button', { name: 'Guardar recorte' }).click()
    await page.getByRole('dialog', { name: 'Etiquetas de la imagen subida' })
      .getByRole('button', { name: 'Omitir' }).click()
    await expect(card).toHaveCount(2)
    const added = (await data.list<CharacterImage>('images', 'normal', { characterId: character.id }))
      .find((item) => item.id !== image.id)!
    expect(added.hasOriginal).toBe(true)
    expect(await (await page.request.get(`/api/data/images/${added.id}/original?scope=normal`)).body()).toEqual(original)
  })

  test('mantiene visibles las acciones a 320 y 390 px sin overflow', async ({ page, data }) => {
    const characterTag = data.unique('etiqueta-galería')
    const characterPrompt = 'Exploradora de tierras lejanas que recuerda cada promesa, protege a su tripulación y nunca abandona una misión difícil.'
    const character = await data.createCharacter({
      name: data.unique('Nombre completo del personaje móvil'),
      prompt: characterPrompt,
      tags: [characterTag]
    })
    await data.createImage(character, ['primera'])
    await data.createImage(character, ['segunda'])

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/characters')
    const desktopCard = page.locator('li').filter({ hasText: character.name })
    const carousel = desktopCard.getByTestId('character-image-carousel')
    const desktopBounds = await carousel.evaluate((element) => element.getBoundingClientRect())
    expect(desktopBounds.height).toBeGreaterThanOrEqual(300)
    await desktopCard.getByRole('button', { name: `Imagen siguiente de ${character.name}` }).click()
    await expect(carousel).toHaveAttribute('data-active-index', '1')
    const tagsButton = desktopCard.getByLabel(
      `Etiquetas de ${character.name}: ${characterTag}`,
      { exact: true }
    )
    await tagsButton.hover()
    await expect(desktopCard.getByRole('tooltip')).toContainText(characterTag)
    const desktopLayout = await desktopCard.evaluate((element) => {
      const image = element.querySelector('[data-testid="character-image-carousel"]')!.getBoundingClientRect()
      const actions = element.querySelector('.character-actions')!.getBoundingClientRect()
      return { actionsBelowImage: actions.top >= image.bottom - 1 }
    })
    expect(desktopLayout.actionsBelowImage).toBe(true)
    await expect(desktopCard.getByText('2 imágenes', { exact: true })).toHaveCount(0)

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 700 })
      await page.goto('/characters')
      const card = page.locator('li').filter({ hasText: character.name })
      const actions = card.locator('.character-actions')
      for (const name of ['Copiar', 'Archivar', 'Exportar', 'Borrar']) {
        await expect(actions.getByRole(name === 'Copiar' ? 'link' : 'button', { name }))
          .toBeVisible()
      }
      const actionSize = await actions.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        tops: Array.from(element.children).map((child) => child.getBoundingClientRect().top)
      }))
      expect(actionSize.scrollWidth).toBeLessThanOrEqual(actionSize.clientWidth)
      expect(Math.max(...actionSize.tops) - Math.min(...actionSize.tops)).toBeLessThanOrEqual(1)
      const tagsButton = card.getByTestId('character-tags-toggle')
      await expect(tagsButton).toBeVisible()
      await expect(tagsButton).toHaveAttribute(
        'aria-label',
        `Mostrar etiquetas de ${character.name}: ${characterTag}`
      )
      await expect(tagsButton).toHaveAttribute('aria-expanded', 'false')
      await tagsButton.click()
      await expect(card.getByTestId('character-mobile-tags')).toContainText(characterTag)
      await expect(tagsButton).toHaveAttribute('aria-expanded', 'true')
      await expect(tagsButton).toHaveAttribute(
        'aria-label',
        `Ocultar etiquetas de ${character.name}: ${characterTag}`
      )
      await tagsButton.click()
      await expect(card.getByTestId('character-mobile-tags')).toHaveCount(0)
      const textLayout = await card.evaluate((element) => {
        const name = element.querySelector('.character-card-link span:last-child')!
        const prompt = Array.from(element.querySelectorAll('p'))
          .find((item) => item.textContent?.includes('Exploradora de tierras lejanas'))!
        return {
          nameFullyVisible: name.scrollHeight <= name.clientHeight + 1,
          promptFullyVisible: prompt.scrollHeight <= prompt.clientHeight + 1
        }
      })
      expect(textLayout).toEqual({ nameFullyVisible: true, promptFullyVisible: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width)

      const main = page.locator('main')
      await main.evaluate((element) => { element.scrollTop = element.scrollHeight })
      expect(await main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
      const promptBounds = await card.getByText(characterPrompt, { exact: true }).boundingBox()
      expect(promptBounds).not.toBeNull()
      await page.mouse.click(
        promptBounds!.x + promptBounds!.width / 2,
        promptBounds!.y + promptBounds!.height / 2
      )
      await expect(page).toHaveURL(`/characters/${character.id}`)
      await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBe(0)
    }
  })

  test('resalta imágenes sin etiquetas salvo la predeterminada', async ({ page, data }) => {
    const character = await data.createCharacter()
    const untagged = await data.createImage(character, ['neutral'])
    const defaultImage = await data.createImage(character, ['neutral'])

    await page.goto(`/characters/${character.id}`)
    const cards = page.getByTestId('character-image-card')
    const warningCard = cards.filter({ has: page.getByTestId('untagged-image-warning') })

    await expect(warningCard).toHaveCount(1)
    await expect(warningCard).toContainText('Sin etiqueta')
    expect(await warningCard.getAttribute('class')).toContain('border-amber-400')
    expect((await data.get<CharacterImage>('images', untagged.id)).isDefault).toBe(false)
    expect((await data.get<CharacterImage>('images', defaultImage.id)).isDefault).toBe(true)
  })

  test('edita etiquetas desde el visor con panel responsive', async ({ page, data }) => {
    const character = await data.createCharacter()
    const firstImage = await data.createImage(character, ['feliz'])
    await data.createImage(character, ['seria'])
    const addedTag = data.unique('visor')

    await page.goto(`/characters/${character.id}`)
    const card = page.getByTestId('character-image-card').first()
    await expect(card.getByLabel('Nueva etiqueta de imagen')).toHaveCount(0)
    await expect(card.getByTestId('character-image-tags')).toContainText('feliz')
    await expect(card.getByTestId('character-image-tags')).not.toContainText('seria')
    await expect(card.getByTestId('character-image-tags').getByRole('button')).toHaveCount(0)
    expect(await card.locator('.border-t').count()).toBe(1)
    const image = card.locator('img').first()
    await expect(image).toBeVisible()
    expect(await image.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(200)
    await card.getByRole('button', { name: 'Ampliar imagen' }).click()
    const dialog = page.getByRole('dialog')
    const details = dialog.getByTestId('image-lightbox-details')
    await expect(details).toContainText('Etiquetas de la imagen')
    await details.getByRole('button', { name: 'Borrar', exact: true }).click()
    const confirmation = page.getByRole('alertdialog')
    await expect(confirmation).toContainText('Esta imagen se borrará definitivamente.')
    await confirmation.getByRole('button', { name: 'Cancelar' }).click()
    await expect(details).toBeVisible()
    await details.getByRole('button', { name: 'seria' }).click()
    await details.getByLabel('Nueva etiqueta de imagen visualizada').fill(addedTag)
    await details.getByLabel('Nueva etiqueta de imagen visualizada').press('Enter')
    await expect.poll(async () => (
      await data.get<CharacterImage>('images', firstImage.id)
    ).tags).toEqual(expect.arrayContaining(['feliz', 'seria', addedTag]))

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 700 })
      const layout = await dialog.locator('section').evaluate((section) => {
        const media = section.firstElementChild!.getBoundingClientRect()
        const aside = section.querySelector('aside')!.getBoundingClientRect()
        return {
          stacked: aside.top >= media.bottom - 1,
          clientWidth: section.clientWidth,
          scrollWidth: section.scrollWidth,
          pageScrollWidth: document.documentElement.scrollWidth
        }
      })
      expect(layout.stacked).toBe(true)
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)
      expect(layout.pageScrollWidth).toBeLessThanOrEqual(width)
    }
  })

  test('confirma antes de borrar imagen desde el visor con Supr', async ({ page, data }) => {
    const character = await data.createCharacter()
    const image = await data.createImage(character, ['borrar'])

    await page.goto(`/characters/${character.id}`)
    await page.getByTestId('character-image-card').getByRole('button', { name: 'Ampliar imagen' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.keyboard.press('Delete')

    const confirmation = page.getByRole('alertdialog')
    await expect(confirmation).toContainText('Esta imagen se borrará definitivamente.')
    await confirmation.getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Delete')
    await confirmation.getByRole('button', { name: 'Borrar' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('character-image-card')).toHaveCount(0)
    expect((await data.list<CharacterImage>('images', 'normal', { characterId: character.id }))
      .some((item) => item.id === image.id)).toBe(false)
  })

  test('copia personaje e imágenes con IDs independientes', async ({ page, data }) => {
    const source = await data.createCharacter({
      imageGenerationPreset: 'Retrato',
      imageGenerationLora: 'Detalle',
      imageGenerationSeed: '12345',
      imageGenerationPromptPrefix: 'masterpiece'
    })
    const sourceImage = await data.createImage(source, ['feliz'])
    const copiedName = data.unique('Copia')

    await page.goto(`/characters/new?copyFrom=${source.id}`)
    await expect(page.getByRole('heading', { name: 'Copiar personaje' })).toBeVisible()
    await page.getByLabel('Nombre').fill(copiedName)
    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect(page).toHaveURL(/\/characters\/[^/]+$/)

    const copied = (await data.list<Character>('characters')).find((item) => item.name === copiedName)
    expect(copied).toBeDefined()
    expect(copied?.id).not.toBe(source.id)
    expect(copied?.imageGenerationPreset).toBe('Retrato')
    expect(copied?.imageGenerationLora).toBe('Detalle')
    expect(copied?.imageGenerationSeed).toBe('12345')
    expect(copied?.imageGenerationPromptPrefix).toBe('masterpiece')
    const copiedImages = await data.list<CharacterImage>('images', 'normal', {
      characterId: copied!.id
    })
    expect(copiedImages).toHaveLength(1)
    expect(copiedImages[0]).toMatchObject({ tags: ['feliz'], isDefault: true })
    expect(copiedImages[0]?.id).not.toBe(sourceImage.id)
  })

  test('cancela y confirma borrado de personaje', async ({ page, data }) => {
    const character = await data.createCharacter()

    await page.goto('/characters')
    const card = page.locator('li').filter({ hasText: character.name })
    await card.getByRole('button', { name: 'Borrar' }).click({ force: true })
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar' }).click()
    await expect(card).toBeVisible()

    await card.getByRole('button', { name: 'Borrar' }).click({ force: true })
    await page.getByRole('alertdialog').getByRole('button', { name: 'Borrar' }).click()
    await expect(card).toHaveCount(0)
    expect((await data.list<Character>('characters')).some((item) => item.id === character.id)).toBe(false)
  })

  test('archiva, filtra y desarchiva sin ofrecer el personaje en historias nuevas', async ({ page, data }) => {
    const character = await data.createCharacter({ name: data.unique('Archivada') })

    await page.goto('/characters')
    const card = page.locator('li').filter({ hasText: character.name })
    await card.getByRole('button', { name: 'Archivar' }).click()
    await expect(card).toHaveCount(0)
    await expect.poll(async () => (await data.get<Character>('characters', character.id)).archived)
      .toBe(true)

    await page.getByRole('button', { name: 'Ver archivados' }).click()
    const archivedCard = page.locator('li').filter({ hasText: character.name })
    await expect(archivedCard).toBeVisible()

    await page.goto('/stories/new')
    await expect(page.getByText(character.name, { exact: true })).toHaveCount(0)

    await page.goto('/characters')
    await page.getByRole('button', { name: 'Ver archivados' }).click()
    await page.locator('li').filter({ hasText: character.name })
      .getByRole('button', { name: 'Desarchivar' }).click()
    await expect.poll(async () => (await data.get<Character>('characters', character.id)).archived)
      .toBe(false)
  })

  test('conserva personajes archivados en historias y bloquea borrarlos indicando títulos', async ({ page, data }) => {
    const character = await data.createCharacter({ name: data.unique('Usada') })
    const first = await data.createStory({
      title: data.unique('Historia-bosque'),
      characters: [character]
    })
    const second = await data.createStory({
      title: data.unique('Historia-mar'),
      characters: [character]
    })

    await page.goto('/characters')
    await page.locator('li').filter({ hasText: character.name })
      .getByRole('button', { name: 'Archivar' }).click()

    await page.goto(`/stories/${first.id}`)
    await expect(page.getByText(character.name, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Ajustes de la historia' }).click()
    await expect(page.getByRole('button', { name: `Editar ${character.name}` })).toBeVisible()

    const blocked = await page.request.delete(`/api/data/characters/${character.id}?scope=normal`)
    expect(blocked.status()).toBe(409)
    expect(await blocked.json()).toMatchObject({
      data: {
        stories: expect.arrayContaining([
          { id: first.id, title: first.title },
          { id: second.id, title: second.title }
        ])
      }
    })

    await page.goto('/characters')
    await page.getByRole('button', { name: 'Ver archivados' }).click()
    await page.locator('li').filter({ hasText: character.name })
      .getByRole('button', { name: 'Borrar' }).click()
    await expect(page.getByRole('alert')).toContainText(first.title)
    await expect(page.getByRole('alert')).toContainText(second.title)
    expect((await data.list<Character>('characters')).some((item) => item.id === character.id))
      .toBe(true)
  })

  test('exporta e importa ZIP con ficha, imagen y sonido', async ({ page, data }) => {
    const source = await data.createCharacter({
      name: data.unique('Exportable'),
      prompt: 'Prompt exportado',
      imageGenerationPreset: 'Retrato',
      imageGenerationLora: 'Detalle',
      imageGenerationSeed: '12345',
      imageGenerationPromptPrefix: 'masterpiece'
    })
    const image = await data.createImage(source, ['feliz'])
    const croppedBytes = createPng(1, 1)
    const cropResponse = await page.request.put(`/api/data/images/${image.id}?scope=normal`, {
      multipart: {
        metadata: JSON.stringify(image),
        file: { name: 'crop.png', mimeType: 'image/png', buffer: croppedBytes }
      }
    })
    await expect(cropResponse).toBeOK()
    await data.createSound(source, ['saludo-exportado'])
    await page.goto('/characters')

    const card = page.locator('li').filter({ hasText: source.name })
    const downloadPromise = page.waitForEvent('download')
    await card.getByRole('button', { name: 'Exportar' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^personaje-.*\.zip$/)
    const path = await download.path()
    expect(path).not.toBeNull()
    const zip = await JSZip.loadAsync(await readFile(path!))
    const manifest = JSON.parse(await zip.file('character.json')!.async('string')) as {
      character: {
        name: string
        prompt: string
        imageGenerationPreset: string
        imageGenerationLora: string
        imageGenerationSeed: string
        imageGenerationPromptPrefix: string
      }
      images: Array<{ path: string; tags: string[]; original: { path: string } }>
      sounds: Array<{ path: string; tags: string[] }>
    }
    expect(manifest.character).toMatchObject({
      name: source.name,
      prompt: 'Prompt exportado',
      imageGenerationPreset: 'Retrato',
      imageGenerationLora: 'Detalle',
      imageGenerationSeed: '12345',
      imageGenerationPromptPrefix: 'masterpiece'
    })
    expect(manifest.images[0]).toMatchObject({ tags: ['feliz'] })
    expect(manifest.sounds[0]).toMatchObject({ tags: ['saludo-exportado'] })
    expect(zip.file(manifest.images[0]!.path)).not.toBeNull()
    expect(await zip.file(manifest.images[0]!.original.path)!.async('nodebuffer')).toEqual(PNG_BYTES)
    expect(zip.file(manifest.sounds[0]!.path)).not.toBeNull()

    const importedName = data.unique('Importada')
    manifest.character.name = importedName
    zip.file('character.json', JSON.stringify(manifest))
    await uploadCharacterZip(page, await zip.generateAsync({ type: 'nodebuffer' }))
    await expect(page.getByRole('status').filter({ hasText: importedName }))
      .toContainText(`«${importedName}» importado`)

    const imported = (await data.list<Character>('characters')).find((item) => item.name === importedName)
    expect(imported).toBeDefined()
    const importedImages = await data.list<CharacterImage>('images', 'normal', { characterId: imported!.id })
    expect(importedImages).toHaveLength(1)
    const importedImage = importedImages[0]!
    expect(importedImage.hasOriginal).toBe(true)
    expect(await (await page.request.get(`/api/data/images/${importedImage.id}/content?scope=normal`)).body()).toEqual(croppedBytes)
    expect(await (await page.request.get(`/api/data/images/${importedImage.id}/original?scope=normal`)).body()).toEqual(PNG_BYTES)
    expect((await data.list<Sound>('sounds')).filter((item) => item.characterId === imported!.id))
      .toHaveLength(1)

    await page.goto('/settings')
    const jsonDownloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exportar JSON' }).click()
    const jsonPath = await (await jsonDownloadPromise).path()
    const bundle = JSON.parse(await readFile(jsonPath!, 'utf8')) as {
      version: number
      characters: Array<{ id: string; name: string; images: Array<{ dataUrl: string; originalDataUrl: string }> }>
      stories: unknown[]; backgrounds: unknown[]; presets: unknown[]; sounds: unknown[]
    }
    expect(bundle.version).toBe(24)
    const exportedCharacter = bundle.characters.find((item) => item.id === source.id)!
    expect(Buffer.from(exportedCharacter.images[0]!.dataUrl.split(',')[1]!, 'base64')).toEqual(croppedBytes)
    expect(Buffer.from(exportedCharacter.images[0]!.originalDataUrl.split(',')[1]!, 'base64')).toEqual(PNG_BYTES)
    const jsonName = data.unique('Original-JSON')
    bundle.characters = [{ ...exportedCharacter, name: jsonName }]
    bundle.stories = []
    bundle.backgrounds = []
    bundle.presets = []
    bundle.sounds = []
    bundle.version = 23
    await page.locator('input[type="file"][accept="application/json"]').setInputFiles({
      name: 'original.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle))
    })
    await expect(page.getByText('Importación completada', { exact: true })).toBeVisible()
    const jsonCharacter = (await data.list<Character>('characters')).find((item) => item.name === jsonName)!
    const jsonImage = (await data.list<CharacterImage>('images', 'normal', { characterId: jsonCharacter.id }))[0]!
    expect(await (await page.request.get(`/api/data/images/${jsonImage.id}/original?scope=normal`)).body()).toEqual(PNG_BYTES)
    expect(await (await page.request.post(`/api/data/images/${jsonImage.id}/original?scope=normal`)).ok()).toBe(true)
    expect(await (await page.request.get(`/api/data/images/${jsonImage.id}/content?scope=normal`)).body()).toEqual(PNG_BYTES)
  })

  test('resuelve homónimos al cancelar, crear o reemplazar', async ({ page, data }) => {
    const first = await data.createCharacter({ name: ' Ana ', prompt: 'Primera Ana' })
    const second = await data.createCharacter({ name: 'ANA', prompt: 'Segunda Ana' })
    const archive = await characterZip('ana')
    await page.goto('/characters')

    await uploadCharacterZip(page, archive)
    let dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Ya existe «ana»')
    await page.setViewportSize({ width: 320, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await dialog.getByRole('button', { name: 'Cancelar' }).click()
    expect((await data.list<Character>('characters')).filter((item) => item.name.trim().toLowerCase() === 'ana'))
      .toHaveLength(2)

    await uploadCharacterZip(page, archive)
    dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Crear nuevo' }).click()
    await dialog.getByLabel('Nombre').fill('Ana')
    await dialog.getByRole('button', { name: 'Importar' }).click()
    await expect(page.getByRole('status').filter({ hasText: '«Ana»' })).toContainText('importado')
    expect((await data.list<Character>('characters')).filter((item) => item.name.trim().toLowerCase() === 'ana'))
      .toHaveLength(3)

    await uploadCharacterZip(page, archive)
    dialog = page.getByRole('dialog')
    await page.setViewportSize({ width: 390, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await dialog.getByRole('button', { name: 'Reemplazar' }).click()
    await dialog.locator('label').filter({ hasText: first.prompt }).getByRole('radio').check()
    await dialog.getByRole('button', { name: 'Continuar' }).click()
    await expect(dialog).toContainText('Confirmar reemplazo')
    await dialog.getByRole('button', { name: 'Reemplazar' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'reemplazado' })).toBeVisible()

    expect((await data.get<Character>('characters', first.id)).prompt).toBe('Prompt desde ZIP')
    expect((await data.get<Character>('characters', second.id)).prompt).toBe('Segunda Ana')
  })

  test('importa solo en colección privada activa', async ({ page, data }) => {
    const name = data.unique('Aislado')
    await data.createCharacter({ name, scope: 'normal' })
    await page.goto('/settings')
    const privateTrigger = page.getByRole('button', { name: 'Activar modo privado' })
    await privateTrigger.click()
    await privateTrigger.click()
    await privateTrigger.click()
    await page.getByRole('link', { name: 'Personajes' }).click()

    await uploadCharacterZip(page, await characterZip(name))
    await expect(page.getByRole('status').filter({ hasText: 'importado' })).toBeVisible()
    expect((await data.list<Character>('characters', 'private')).filter((item) => item.name === name))
      .toHaveLength(1)
    expect((await data.list<Character>('characters', 'normal')).filter((item) => item.name === name))
      .toHaveLength(1)
  })

  test('aísla etiquetas de imágenes entre colecciones', async ({ page, data }) => {
    const publicCharacter = await data.createCharacter({ name: data.unique('Público') })
    const publicTag = data.unique('etiqueta-publica')
    await data.createImage(publicCharacter, [publicTag], 'normal')

    const privateCharacter = await data.createCharacter({
      name: data.unique('Privado'),
      scope: 'private'
    })
    const privateTag = data.unique('etiqueta-privada')
    await data.createImage(privateCharacter, [privateTag], 'private')

    await page.goto(`/characters/${publicCharacter.id}`)
    const imageTags = page.getByTestId('character-image-tags')
    await expect(imageTags.getByText(publicTag, { exact: true })).toBeVisible()
    await expect(imageTags.getByText(privateTag, { exact: true })).toHaveCount(0)

    await page.goto('/settings')
    const privateTrigger = page.getByRole('button', { name: 'Activar modo privado', exact: true })
    await privateTrigger.click()
    await privateTrigger.click()
    await privateTrigger.click()
    await expect(page).toHaveURL('/settings')
    await expect(page.getByRole('button', { name: 'Salir del modo privado', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'Personajes', exact: true }).click()
    await page.getByRole('link', { name: privateCharacter.name, exact: true }).click()
    await expect(imageTags.getByText(privateTag, { exact: true })).toBeVisible()
    await expect(imageTags.getByText(publicTag, { exact: true })).toHaveCount(0)

    await page.getByRole('link', { name: 'Ajustes', exact: true }).click()
    await page.locator('main').press('Control+Alt+p')
    await expect(page).toHaveURL('/settings')
    await page.getByRole('link', { name: 'Personajes', exact: true }).click()
    await page.getByRole('link', { name: publicCharacter.name, exact: true }).click()
    await expect(imageTags.getByText(publicTag, { exact: true })).toBeVisible()
    await expect(imageTags.getByText(privateTag, { exact: true })).toHaveCount(0)
  })
})

test.describe('fondos', () => {
  test('recarga fondos y sonidos asociados conservando el borrador nuevo', async ({ page, data }) => {
    const draftTag = data.unique('borrador-fondo')
    const draftDescription = data.unique('descripcion-borrador')
    const externalTag = data.unique('fondo-externo')
    const soundTag = data.unique('sonido-externo')

    await page.goto('/backgrounds')
    await page.getByLabel('Etiquetas').fill(draftTag)
    await page.getByLabel('Descripción', { exact: true }).fill(draftDescription)

    const external = await data.createBackground({ tags: [externalTag] })
    await data.createSound(null, [soundTag], 'normal', external)
    await page.getByRole('button', { name: 'Recargar', exact: true }).click()

    const card = page.locator('li').filter({ hasText: externalTag })
    await expect(card).toBeVisible()
    await expect(card.getByText(soundTag, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: `Quitar etiqueta ${draftTag}` })).toBeVisible()
    await expect(page.getByLabel('Descripción', { exact: true })).toHaveValue(draftDescription)

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 800 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }
  })

  test('previsualiza PNG antes de añadir, permite recortarlo y edita sus datos', async ({ page, data }) => {
    const tag = data.unique('bosque')
    const extraTag = data.unique('exterior')
    const description = data.unique('Bosque-nocturno')
    const updatedDescription = data.unique('Bosque-actualizado')
    const style = data.unique('Manga')
    const updatedStyle = data.unique('Dibujo')

    await page.goto('/backgrounds')
    await page.getByLabel('Etiquetas', { exact: true }).fill(tag)
    await page.getByLabel('Etiquetas', { exact: true }).press('Enter')
    await page.getByLabel('Descripción', { exact: true }).fill(description)
    await page.getByLabel('Estilo', { exact: true }).fill(style)
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
      name: 'fondo.png',
      mimeType: 'image/png',
      buffer: PNG_BYTES
    })
    const preview = page.getByRole('dialog', { name: 'Añadir imagen' })
    await expect(preview.getByRole('img', { name: 'Vista previa de imagen' })).toBeVisible()
    const add = preview.getByRole('button', { name: 'Añadir', exact: true })
    await expect(add).toBeFocused()
    expect(await add.getAttribute('class')).toContain('btn-primary')

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 700 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }

    await preview.getByRole('button', { name: 'Recortar', exact: true }).click()
    const crop = page.getByRole('dialog', { name: 'Recortar imagen' })
    await expect(crop.getByRole('button', { name: 'Guardar recorte' })).toBeVisible()
    await crop.getByRole('button', { name: 'Usar original' }).click()

    const card = page.locator('li').filter({ hasText: tag })
    await expect(card).toBeVisible()
    await expect(card.getByLabel('Estilo del fondo')).toHaveValue(style)
    await card.getByLabel('Etiquetas del fondo').fill(extraTag)
    await card.getByLabel('Etiquetas del fondo').press('Enter')
    await expect.poll(async () => (await data.list<Background>('backgrounds')).find(
      (background) => background.tags.includes(tag)
    )?.tags).toContain(extraTag)
    await card.getByLabel('Descripción del fondo').fill(updatedDescription)
    await card.getByLabel('Descripción del fondo').press('Tab')
    await card.getByLabel('Estilo del fondo').fill(updatedStyle)
    await card.getByLabel('Estilo del fondo').press('Tab')

    await expect.poll(async () => (await data.list<Background>('backgrounds')).find(
      (background) => background.tags.includes(tag)
    )?.description).toBe(updatedDescription)
    await expect.poll(async () => (await data.list<Background>('backgrounds')).find(
      (background) => background.tags.includes(tag)
    )?.style).toBe(updatedStyle)
    const stored = (await data.list<Background>('backgrounds')).find(
      (background) => background.tags.includes(tag)
    )
    expect(stored).toMatchObject({ tags: [tag, extraTag], description: updatedDescription })
    expect(stored?.style).toBe(updatedStyle)
  })

  test('rechaza etiqueta duplicada y confirma borrado', async ({ page, data }) => {
    const duplicateTag = data.unique('duplicada')
    const target = await data.createBackground({ tags: [data.unique('objetivo')] })
    await data.createBackground({ tags: [duplicateTag] })

    await page.goto('/backgrounds')
    const card = page.locator('li').filter({ hasText: target.tags[0]! })
    await card.getByLabel('Etiquetas del fondo').fill(duplicateTag)
    await card.getByLabel('Etiquetas del fondo').press('Enter')
    await expect(page.getByRole('alert')).toContainText('Ya existe un fondo')

    await page.reload()
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Borrar' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar' }).click()
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Borrar' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Borrar' }).click()
    await expect(card).toHaveCount(0)
  })
})
