import type { Background, Character, CharacterImage } from '../../shared/types'
import { expect, PNG_BYTES, test } from './fixtures'

test.describe('personajes', () => {
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

  test('copia personaje e imágenes con IDs independientes', async ({ page, data }) => {
    const source = await data.createCharacter()
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
