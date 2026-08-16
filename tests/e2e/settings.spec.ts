import type { AppSettings, Character, DatabaseBackup, PromptPreset } from '../../shared/types'
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

test('prepara Chrome AI y guarda override privado', async ({ page, data }) => {
  await data.patchSettings({ useChromeLlm: false, privateUseChromeLlm: null })
  await page.addInitScript(() => {
    type Monitor = {
      addEventListener: (type: string, listener: (event: { loaded: number }) => void) => void
    }
    type CreateOptions = { monitor?: (monitor: Monitor) => void }

    class FakeLanguageModel {
      static async availability() {
        return 'downloadable'
      }

      static async create(options?: CreateOptions) {
        options?.monitor?.({
          addEventListener(_type, listener) {
            listener({ loaded: 0.5 })
            listener({ loaded: 1 })
          }
        })
        return new FakeLanguageModel()
      }

      destroy() {}
    }

    Object.defineProperty(globalThis, 'LanguageModel', {
      configurable: true,
      value: FakeLanguageModel
    })
  })

  await page.goto('/settings')
  const checkbox = page.getByRole('checkbox', { name: /Usar IA local de Chrome/ })
  await checkbox.click()
  await expect(page.getByText('Modelo local preparado.', { exact: true })).toBeVisible()
  await expect.poll(async () => {
    const response = await page.request.get('/api/settings')
    return ((await response.json()) as AppSettings).useChromeLlm
  }).toBe(true)

  const privateTrigger = page.getByRole('button', { name: 'Activar modo privado' })
  await privateTrigger.click()
  await privateTrigger.click()
  await privateTrigger.click()
  await expect(page).toHaveURL('/')
  await page.getByRole('link', { name: 'Ajustes' }).click()

  const privateCheckbox = page.getByRole('checkbox', { name: /Usar IA local de Chrome/ })
  await expect(privateCheckbox).toBeChecked()
  await privateCheckbox.uncheck()
  await expect.poll(async () => {
    const response = await page.request.get('/api/settings')
    return ((await response.json()) as AppSettings).privateUseChromeLlm
  }).toBe(false)

  const invalid = await page.request.patch('/api/settings', {
    data: { useChromeLlm: 'sí' }
  })
  expect(invalid.status()).toBe(400)

  await data.patchSettings({ useChromeLlm: false, privateUseChromeLlm: null })
})

test('no activa Chrome AI cuando navegador es incompatible', async ({ page, data }) => {
  await data.patchSettings({ useChromeLlm: false, privateUseChromeLlm: null })
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'LanguageModel', {
      configurable: true,
      value: {
        async availability() {
          return 'unavailable'
        }
      }
    })
  })

  await page.goto('/settings')
  const checkbox = page.getByRole('checkbox', { name: /Usar IA local de Chrome/ })
  await checkbox.click()

  await expect(page.getByRole('alert')).toContainText('no está disponible')
  await expect(checkbox).not.toBeChecked()
  const response = await page.request.get('/api/settings')
  expect(((await response.json()) as AppSettings).useChromeLlm).toBe(false)
})

test('muestra, crea y restaura backups SQLite con confirmación', async ({ page, data }) => {
  const character = await data.createCharacter({ name: data.unique('Original-backup') })
  const response = await page.request.post('/api/backups')
  await expect(response).toBeOK()
  const existing = await response.json() as DatabaseBackup

  const changedName = data.unique('Cambiado-después-backup')
  const changedResponse = await page.request.put(
    `/api/data/characters/${character.id}?scope=normal`,
    { data: { ...character, name: changedName } }
  )
  await expect(changedResponse).toBeOK()

  await page.goto('/settings')
  const existingRow = page.getByRole('listitem').filter({ hasText: existing.name })
  await expect(existingRow).toBeVisible()
  await expect(existingRow.getByText('Manual', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Crear backup' }).click()
  await expect(page.getByText(/^Backup creado:/)).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveCount(2)

  await existingRow.getByRole('button', { name: 'Restaurar' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Restaurar backup' })
  await expect(dialog).toContainText('colección normal, colección privada y ajustes')
  await dialog.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dialog).toHaveCount(0)

  await existingRow.getByRole('button', { name: 'Restaurar' }).click()
  await page.getByRole('alertdialog', { name: 'Restaurar backup' })
    .getByRole('button', { name: 'Restaurar' }).click()
  await expect(page.getByText(`Backup restaurado: ${existing.name}`)).toBeVisible()
  expect((await data.get<Character>('characters', character.id)).name).toBe(character.name)
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
