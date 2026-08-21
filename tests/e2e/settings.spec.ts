import type { AppSettings, Character, DatabaseBackup, PromptPreset } from '../../shared/types'
import { expect, test } from './fixtures'

test('avisa de una actualización, permite descartarla y comprobarla en Ajustes', async ({ page }) => {
  const update = {
    currentVersion: 'main-old123',
    currentCommit: 'old123',
    latestVersion: 'main-new456',
    publishedAt: '2026-08-19T10:00:00Z',
    releaseUrl: 'https://github.com/jonatancheca/MisHistorias/releases/tag/main-new456',
    downloadUrl: 'https://example.test/app.zip',
    checksumUrl: 'https://example.test/app.zip.sha256',
    updaterUrl: 'https://example.test/update.ps1',
    updateAvailable: true
  }

  await page.addInitScript(() => localStorage.removeItem('mishistorias.dismissed-update.v1'))
  await page.route('**/api/app-update**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(update) })
  })

  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/')
  const banner = page.getByTestId('app-update-banner')
  await expect(banner).toContainText('main-new456')
  await expect(banner.getByRole('link', { name: 'Descargar actualizador' }))
    .toHaveAttribute('href', 'https://example.test/update.ps1')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)

  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await banner.getByRole('button', { name: 'Descartar actualización' }).click()
  await expect(banner).toHaveCount(0)
  await page.reload()
  await expect(banner).toHaveCount(0)

  await page.goto('/settings')
  const updateSettings = page.getByTestId('app-update-settings')
  await expect(updateSettings).toContainText('main-old123')
  await expect(updateSettings).toContainText('main-new456')
  await updateSettings.getByRole('button', { name: 'Comprobar ahora' }).click()
  await expect(updateSettings.getByRole('link', { name: 'Descargar actualizador' }))
    .toHaveAttribute('href', 'https://example.test/update.ps1')
})

test('muestra en Ajustes un error al comprobar actualizaciones', async ({ page }) => {
  await page.route('**/api/app-update**', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ statusMessage: 'GitHub no disponible para la prueba.' })
    })
  })

  await page.goto('/settings')
  await expect(page.getByTestId('app-update-settings').getByRole('alert'))
    .toContainText('GitHub no disponible para la prueba.')
})

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

  const privateTrigger = page.locator('button[aria-label="Activar modo privado"]')
  await privateTrigger.click({ clickCount: 3, delay: 80, force: true })
  await expect(page).toHaveURL('/private/login')
  await expect(page.locator('html')).toHaveClass(/nsfw-scope/)

  // Override privado sigue siendo setting de scope (API), no UI de colección rosa
  await data.patchSettings({ privateUseChromeLlm: false })
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
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeEnabled()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect.poll(async () => {
    const stored = (await data.list<PromptPreset>('presets')).find((preset) => preset.name === name)
    return stored?.content
  }).toBe(updatedContent)

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

  // Aislamiento de colecciones (API)
  expect((await data.list<Character>('characters', 'normal')).some((item) => item.id === normal.id))
    .toBe(true)
  expect((await data.list<Character>('characters', 'private'))
    .some((item) => item.id === privateCharacter.id)).toBe(true)
  expect((await data.list<Character>('characters', 'normal'))
    .some((item) => item.id === privateCharacter.id)).toBe(false)
  expect((await data.list<Character>('characters', 'private'))
    .some((item) => item.id === normal.id)).toBe(false)

  await page.goto('/settings')
  const privateTrigger = page.locator('button[aria-label="Activar modo privado"]')
  await privateTrigger.click({ clickCount: 3, delay: 80, force: true })
  await expect(page).toHaveURL('/private/login')
})
