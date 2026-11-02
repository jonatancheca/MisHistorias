import type { Character, CharacterImage } from '../../shared/types'
import { expect, PNG_BYTES, test } from './fixtures'

for (const scope of ['normal', 'private'] as const) {
  test(`filtra etiquetas del personaje y conserva selección y creación en ${scope}`, async ({ page, data }) => {
    const selected = data.unique('guardiana')
    const matching = data.unique('aventurera soleada')
    const other = data.unique('cazadora')
    const accented = data.unique('acción')
    const hidden = data.unique('soleada-otra-colección')
    const character = await data.createCharacter({ tags: [selected], scope })
    await data.createCharacter({ tags: [matching, other, accented], scope })
    await data.createCharacter({ tags: [hidden], scope: scope === 'normal' ? 'private' : 'normal' })

    await page.goto('/characters')
    if (scope === 'private') await page.locator('main').press('Control+Alt+p')
    await page.getByRole('link', { name: character.name, exact: true }).click()
    const input = page.getByLabel('Etiquetas del personaje')
    const badges = input.locator('../..').getByRole('group', { name: 'Etiquetas disponibles' })
    const badge = (name: string) => badges.getByRole('button', { name, exact: true })

    await expect(badge(other)).toBeVisible()
    await expect(badge(hidden)).toHaveCount(0)
    await input.fill('  SOLE  ')
    await expect(badge(matching)).toBeVisible()
    await expect(badge(selected)).toHaveAttribute('aria-pressed', 'true')
    await expect(badge(other)).toHaveCount(0)
    await badge(matching).click()
    await expect(input).toHaveValue('')
    await expect(badge(matching)).toHaveAttribute('aria-pressed', 'true')
    await expect(badge('SOLE')).toHaveCount(0)
    await expect(badge(other)).toBeVisible()

    await input.fill('accion')
    await expect(badge(accented)).toHaveCount(0)
    await input.fill('ACCIÓN')
    await expect(badge(accented)).toBeVisible()
    await badge(selected).click()
    await expect(input).toHaveValue('ACCIÓN')
    await expect(badge(selected)).toHaveCount(0)
    await badge(accented).click()

    const created = data.unique('nueva')
    await input.fill(created)
    await expect(badges.getByRole('button')).toHaveCount(2)
    await input.press('Enter')
    await expect(badge(created)).toHaveAttribute('aria-pressed', 'true')
    const commaTag = data.unique('coma')
    await input.fill(commaTag)
    await input.press(',')
    const pasted = [data.unique('pegada-1'), data.unique('pegada-2')]
    await input.fill(pasted.join(', '))
    await input.press('Enter')
    const blurred = data.unique('al-salir')
    await input.fill(blurred)
    await page.getByLabel('Prompt del personaje').click()

    const expected = [matching, accented, created, commaTag, ...pasted, blurred]
    await expect.poll(async () => (await data.get<Character>('characters', character.id, scope)).tags)
      .toEqual(expected)
    await page.goto('/characters')
    if (scope === 'private') await page.locator('main').press('Control+Alt+p')
    await page.getByRole('link', { name: character.name, exact: true }).click()
    for (const tag of expected) await expect(badge(tag)).toHaveAttribute('aria-pressed', 'true')
  })
}

test.describe('filtro de etiquetas de imágenes en móvil', () => {
  test.use({ hasTouch: true })

  for (const width of [320, 390]) {
    test(`selecciona con touch sin crear el fragmento ni desbordar a ${width}px`, async ({ page, data }) => {
      await page.setViewportSize({ width, height: 844 })
      const character = await data.createCharacter({ name: `QA Filtro de etiquetas ${width}px` })
      const matching = data.unique('sonriente')
      const other = data.unique('mirada-tranquila')
      await data.createImage(character, [matching, other])
      await page.goto(`/characters/${character.id}`)
      await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
        name: 'filtro.png', mimeType: 'image/png', buffer: PNG_BYTES
      })
      await page.getByRole('dialog', { name: 'Añadir imagen' })
        .getByRole('button', { name: 'Añadir', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Etiquetas de la imagen subida' })
      const input = dialog.getByLabel('Etiquetas', { exact: true })
      const badges = dialog.getByRole('group', { name: 'Etiquetas disponibles' })
      await input.fill('SONR')
      await expect(badges.getByRole('button', { name: other, exact: true })).toHaveCount(0)
      await badges.getByRole('button', { name: matching, exact: true }).tap()
      await expect(input).toHaveValue('')
      await expect(badges.getByRole('button', { name: 'SONR', exact: true })).toHaveCount(0)
      await expect(badges.getByRole('button', { name: matching, exact: true }))
        .toHaveAttribute('aria-pressed', 'true')
      await input.fill('sin-coincidencias')
      await expect(badges.getByRole('button')).toHaveCount(1)
      const layout = await dialog.evaluate((element) => ({
        scroll: element.scrollWidth,
        client: element.clientWidth,
        page: document.documentElement.scrollWidth
      }))
      expect(layout.scroll).toBeLessThanOrEqual(layout.client)
      expect(layout.page).toBeLessThanOrEqual(width)
      await input.fill('TRAN')
      await expect(badges.getByRole('button', { name: other, exact: true })).toBeVisible()
      await page.screenshot({ path: `.data/issue-272-${width}.png`, fullPage: true })
      await input.fill('')
      await dialog.getByRole('button', { name: 'Guardar etiquetas' }).click()
      await expect.poll(async () => (
        await data.list<CharacterImage>('images', 'normal', { characterId: character.id })
      ).map((image) => image.tags)).toEqual([[matching, other], [matching]])
    })
  }
})
