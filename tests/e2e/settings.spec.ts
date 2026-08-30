import type { AppSettings, Character, DatabaseBackup } from '../../shared/types'
import { DEFAULT_PRESET_CONTENT } from '../../app/lib/defaultPreset'
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
      body: JSON.stringify({ message: 'GitHub no disponible para la prueba.' })
    })
  })

  await page.goto('/settings')
  await expect(page.getByTestId('app-update-settings').getByRole('alert'))
    .toContainText('GitHub no disponible para la prueba.')
})

test('agrupa LLM y unifica controles de conexión y tokens', async ({ page, data }) => {
  await data.patchSettings({ apiKey: 'lm-token', swarmAuthToken: 'swarm-token', swarmBaseUrl: 'http://localhost:7801' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/settings')

  const llm = page.getByTestId('llm-settings')
  const swarm = page.getByTestId('swarm-settings')
  await expect(llm.getByRole('heading', { name: 'LLM' })).toBeVisible()
  const llmTest = llm.getByRole('button', { name: 'Probar conexión' })
  const swarmTest = swarm.getByRole('button', { name: 'Probar conexión' })
  await expect(llmTest).toBeVisible()
  await expect(swarmTest).toBeVisible()
  expect(await swarmTest.locator('path').getAttribute('d'))
    .toBe(await llmTest.locator('path').getAttribute('d'))

  const tokenInput = page.getByLabel('Token de SwarmUI (opcional)')
  const showToken = page.getByRole('button', { name: 'Mostrar token SwarmUI' })
  const removeToken = page.getByRole('button', { name: 'Quitar token SwarmUI' })
  await expect(showToken).toBeVisible()
  await expect(removeToken).toBeVisible()
  expect(await showToken.evaluate((element) => element.getBoundingClientRect().left))
    .toBeGreaterThan(await tokenInput.evaluate((element) => element.getBoundingClientRect().left))
  expect(await removeToken.evaluate((element) => element.getBoundingClientRect().left))
    .toBeGreaterThan(await showToken.evaluate((element) => element.getBoundingClientRect().left))
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await page.setViewportSize({ width: 320, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
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

test('personaliza LMStudio en privado y vuelve a heredar al desactivarlo', async ({ page, data }) => {
  await data.patchSettings({
    baseUrl: 'http://normal.test',
    apiKey: 'normal-secret',
    model: 'normal-model',
    temperature: 0.6,
    maxTokens: 900,
    historyBudget: 5000,
    privateLlmSettingsEnabled: false,
    privateBaseUrl: null,
    privateApiKey: '',
    privateModel: null,
    privateTemperature: null,
    privateMaxTokens: null,
    privateHistoryBudget: null
  })

  await page.goto('/settings')
  const privateTrigger = page.getByRole('button', { name: 'Activar modo privado' })
  await privateTrigger.click()
  await privateTrigger.click()
  await privateTrigger.click()
  await expect(page).toHaveURL('/')
  await page.getByRole('link', { name: 'Ajustes' }).click()

  const customize = page.getByRole('checkbox', { name: /Personalizar ajustes de LMStudio/ })
  const baseUrl = page.getByLabel('URL del servidor (LMStudio)')
  const model = page.getByLabel('Modelo')
  await expect(customize).not.toBeChecked()
  await expect(baseUrl).toBeDisabled()
  await expect(baseUrl).toHaveValue('http://normal.test')
  await expect(model).toHaveValue('normal-model')

  await customize.check()
  await expect(baseUrl).toBeEnabled()
  const copiedToken = await page.request.post('/api/settings/api-key?scope=private')
  expect(await copiedToken.json()).toEqual({ apiKey: 'normal-secret' })

  await baseUrl.fill('http://private.test')
  await model.fill('private-model')
  await page.getByLabel('Temperatura').fill('1.2')
  await page.getByLabel('Máx. tokens').fill('1200')
  await page.getByLabel('Historial (caracteres)').fill('7000')
  await page.getByLabel('Token de acceso (opcional)').fill('private-secret')
  await expect(page.getByText('Guardado', { exact: true })).toBeVisible()

  let modelsScope = ''
  await page.route('**/api/llm/models**', async (route) => {
    modelsScope = new URL(route.request().url()).searchParams.get('scope') ?? ''
    await route.fulfill({ status: 200, contentType: 'application/json', body: '["private-model"]' })
  })
  await page.getByTestId('llm-settings').getByRole('button', { name: 'Probar conexión' }).click()
  await expect(page.getByText('1 modelos disponibles')).toBeVisible()
  expect(modelsScope).toBe('private')

  const stored = await page.request.get('/api/settings')
  expect(await stored.json()).toMatchObject({
    baseUrl: 'http://normal.test',
    model: 'normal-model',
    privateLlmSettingsEnabled: true,
    privateBaseUrl: 'http://private.test',
    privateModel: 'private-model',
    privateTemperature: 1.2,
    privateMaxTokens: 1200,
    privateHistoryBudget: 7000
  })
  const privateToken = await page.request.post('/api/settings/api-key?scope=private')
  expect(await privateToken.json()).toEqual({ apiKey: 'private-secret' })

  await customize.uncheck()
  await expect(baseUrl).toBeDisabled()
  await expect(baseUrl).toHaveValue('http://normal.test')
  await expect.poll(async () => {
    const response = await page.request.get('/api/settings')
    return ((await response.json()) as AppSettings).privateLlmSettingsEnabled
  }).toBe(false)
  const inheritedToken = await page.request.post('/api/settings/api-key?scope=private')
  expect(await inheritedToken.json()).toEqual({ apiKey: 'normal-secret' })
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

test('muestra prompt narrativo integrado y elimina mantenimiento de prompts', async ({ page }) => {
  await page.goto('/settings')
  const prompt = page.getByLabel('Prompt narrativo integrado')
  await expect(prompt).toHaveValue(DEFAULT_PRESET_CONTENT)
  await expect(prompt).toHaveAttribute('readonly', '')
  await expect(page.getByRole('link', { name: 'Prompts', exact: true })).toHaveCount(0)
  await page.goto('/prompts')
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
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
