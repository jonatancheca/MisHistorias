import type { AppSettings, Character, PromptPreset } from '../../shared/types'
import { expect, test } from './fixtures'

test('autoguarda apariencia, modo prueba y velocidad', async ({ page, data }) => {
  const userName = data.unique('Protagonista')
  await data.patchSettings({ theme: 'system', mockMode: false, responseSpeed: 'high' })

  await page.goto('/settings')
  await page.getByRole('button', { name: 'Modo oscuro' }).click()
  await page.getByRole('checkbox', { name: /Modo prueba \(sin LLM\)/ }).check()
  await page.getByLabel('Velocidad de escritura').selectOption('instant')
  await page.getByLabel('Nombre', { exact: true }).fill(userName)
  await expect(page.getByText('Guardado', { exact: true })).toBeVisible()

  const response = await page.request.get('/api/settings')
  await expect(response).toBeOK()
  const settings = await response.json() as AppSettings
  expect(settings).toMatchObject({
    theme: 'dark',
    mockMode: true,
    responseSpeed: 'instant',
    userName
  })
  await expect(page.locator('html')).toHaveClass(/dark/)
})

test('crea, edita, activa y borra prompt', async ({ page, data }) => {
  await data.createPreset({ name: data.unique('Prompt-base') })
  const name = data.unique('Prompt-UI')
  const content = data.unique('Contenido')
  const updatedContent = data.unique('Contenido-editado')

  await page.goto('/prompts')
  await page.getByRole('button', { name: 'Nuevo prompt' }).click()
  await page.getByLabel('Nombre').fill(name)
  await page.getByLabel('Contenido').fill(content)
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('button', { name })).toBeVisible()
  await page.getByRole('button', { name: 'Marcar como activo' }).click()
  await expect(page.getByRole('button', { name: new RegExp(`${name}.*activo`) })).toBeVisible()

  await page.getByLabel('Contenido').fill(updatedContent)
  await page.getByRole('button', { name: 'Guardar' }).click()
  const stored = (await data.list<PromptPreset>('presets')).find((preset) => preset.name === name)
  expect(stored?.content).toBe(updatedContent)

  await page.getByRole('button', { name: 'Borrar' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Borrar' }).click()
  await expect(page.getByRole('button', { name })).toHaveCount(0)
  expect((await data.list<PromptPreset>('presets')).some((preset) => preset.name === name)).toBe(false)
})

test('separa datos normales y privados', async ({ page, data }) => {
  const normal = await data.createCharacter({ name: data.unique('Normal') })
  const privateCharacter = await data.createCharacter({
    name: data.unique('Privado'),
    scope: 'private'
  })

  await page.goto('/settings')
  const privateTrigger = page.getByRole('button', { name: 'Activar modo privado' })
  await privateTrigger.click()
  await privateTrigger.click()
  await privateTrigger.click()
  await expect(page).toHaveURL('/')
  await page.getByRole('link', { name: 'Personajes' }).click()
  await expect(page.getByText(privateCharacter.name, { exact: true })).toBeVisible()
  await expect(page.getByText(normal.name, { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Salir del modo privado' }).click()
  await expect(page).toHaveURL('/')
  await page.getByRole('link', { name: 'Personajes' }).click()
  await expect(page.getByText(normal.name, { exact: true })).toBeVisible()
  await expect(page.getByText(privateCharacter.name, { exact: true })).toHaveCount(0)

  expect((await data.list<Character>('characters', 'normal')).some((item) => item.id === normal.id))
    .toBe(true)
  expect((await data.list<Character>('characters', 'private'))
    .some((item) => item.id === privateCharacter.id)).toBe(true)
})
