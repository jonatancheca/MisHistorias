import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
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

test.describe('personajes', () => {
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

  test('autoguarda edición de personaje existente', async ({ page, data }) => {
    const character = await data.createCharacter()
    const updatedPrompt = data.unique('Prompt-editado')

    await page.goto(`/characters/${character.id}`)
    await page.getByLabel('Prompt del personaje').fill(updatedPrompt)
    await expect(page.getByText('Guardado', { exact: true })).toBeVisible()

    await expect.poll(async () => (await data.get<Character>('characters', character.id)).prompt)
      .toBe(updatedPrompt)
  })

  test('previsualiza una imagen y prioriza añadir originales', async ({ page, data }) => {
    const character = await data.createCharacter()
    await page.goto(`/characters/${character.id}`)
    const upload = page.locator('input[type="file"][accept="image/*"]')

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
  })

  test('recorta imágenes guardadas y restaura siempre la primera original', async ({ page, data }) => {
    const character = await data.createCharacter()
    await page.goto(`/characters/${character.id}`)
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
      name: 'original.png', mimeType: 'image/png', buffer: createPng(128, 96)
    })
    await page.getByRole('dialog', { name: 'Añadir imagen' }).getByRole('button', { name: 'Añadir', exact: true }).click()
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
    await expect(card).toHaveCount(2)
    const added = (await data.list<CharacterImage>('images', 'normal', { characterId: character.id }))
      .find((item) => item.id !== image.id)!
    expect(added.hasOriginal).toBe(true)
    expect(await (await page.request.get(`/api/data/images/${added.id}/original?scope=normal`)).body()).toEqual(original)
  })

  test('mantiene visibles las acciones a 320 y 390 px sin overflow', async ({ page, data }) => {
    const character = await data.createCharacter()

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
        scrollWidth: element.scrollWidth
      }))
      expect(actionSize.scrollWidth).toBeLessThanOrEqual(actionSize.clientWidth)
      expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width)
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
    const image = card.locator('img').first()
    await expect(image).toBeVisible()
    expect(await image.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(200)
    await card.getByRole('button', { name: 'Ampliar imagen' }).click()
    const dialog = page.getByRole('dialog')
    const details = dialog.getByTestId('image-lightbox-details')
    await expect(details).toContainText('Etiquetas de la imagen')
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
    await expect(page.getByRole('heading', { name: character.name })).toBeVisible()

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
      stories: unknown[]; backgrounds: unknown[]; presets: unknown[]
    }
    expect(bundle.version).toBe(19)
    const exportedCharacter = bundle.characters.find((item) => item.id === source.id)!
    expect(Buffer.from(exportedCharacter.images[0]!.dataUrl.split(',')[1]!, 'base64')).toEqual(croppedBytes)
    expect(Buffer.from(exportedCharacter.images[0]!.originalDataUrl.split(',')[1]!, 'base64')).toEqual(PNG_BYTES)
    const jsonName = data.unique('Original-JSON')
    bundle.characters = [{ ...exportedCharacter, name: jsonName }]
    bundle.stories = []
    bundle.backgrounds = []
    bundle.presets = []
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
})

test.describe('fondos', () => {
  test('sube PNG, edita etiquetas y descripción', async ({ page, data }) => {
    const tag = data.unique('bosque')
    const extraTag = data.unique('exterior')
    const description = data.unique('Bosque-nocturno')
    const updatedDescription = data.unique('Bosque-actualizado')

    await page.goto('/backgrounds')
    await page.getByLabel('Etiquetas').fill(tag)
    await page.getByLabel('Etiquetas').press('Enter')
    await page.getByLabel('Descripción').fill(description)
    await page.locator('input[type="file"]').setInputFiles({
      name: 'fondo.png',
      mimeType: 'image/png',
      buffer: PNG_BYTES
    })
    await page.getByRole('dialog', { name: 'Recortar imagen' })
      .getByRole('button', { name: 'Usar original' }).click()

    const card = page.locator('li').filter({ hasText: tag })
    await expect(card).toBeVisible()
    await card.getByLabel('Etiquetas del fondo').fill(extraTag)
    await card.getByLabel('Etiquetas del fondo').press('Enter')
    await expect.poll(async () => (await data.list<Background>('backgrounds')).find(
      (background) => background.tags.includes(tag)
    )?.tags).toContain(extraTag)
    await card.getByLabel('Descripción del fondo').fill(updatedDescription)
    await card.getByLabel('Descripción del fondo').press('Tab')

    await expect.poll(async () => (await data.list<Background>('backgrounds')).find(
      (background) => background.tags.includes(tag)
    )?.description).toBe(updatedDescription)
    const stored = (await data.list<Background>('backgrounds')).find(
      (background) => background.tags.includes(tag)
    )
    expect(stored).toMatchObject({ tags: [tag, extraTag], description: updatedDescription })
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
