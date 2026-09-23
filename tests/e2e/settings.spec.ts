import { readFile } from 'node:fs/promises'
import type { AppSettings, Character, DatabaseBackup } from '../../shared/types'
import { DEFAULT_CHARACTER_REFERENCE_PROMPT } from '../../app/lib/characterReferencePrompt'
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

test('protege tokens configurados y conserva sus controles de conexión', async ({ page, data }) => {
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

  const llmTokenInput = page.getByLabel('Token de acceso (opcional)')
  const swarmTokenInput = page.getByLabel('Token de SwarmUI (opcional)')
  await expect(llmTokenInput).toHaveValue('')
  await expect(llmTokenInput).toHaveAttribute('placeholder', '****')
  await expect(swarmTokenInput).toHaveValue('')
  await expect(swarmTokenInput).toHaveAttribute('placeholder', '****')
  await expect(page.getByRole('button', { name: /Mostrar token/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Quitar token', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Quitar token SwarmUI', exact: true })).toBeVisible()
  expect((await page.request.post('/api/settings/api-key')).status()).toBe(404)
  expect((await page.request.post('/api/settings/swarm-token')).status()).toBe(404)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await page.setViewportSize({ width: 320, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})

test('precarga el modelo elegido y confirma la descarga global incluso con Chrome activo', async ({ page, data }) => {
  const initial = (await (await page.request.get('/api/settings')).json()) as AppSettings
  const actions: string[] = []
  await data.patchSettings({ model: 'modelo-ausente', useChromeLlm: true })
  await page.route('**/api/llm/models**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '["modelo-disponible"]' })
  })
  await page.route('**/api/llm/model-management', async (route) => {
    const body = route.request().postDataJSON() as { action: string; scope: string }
    actions.push(`${body.action}:${body.scope}`)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body.action === 'load'
        ? { status: 'loaded', instanceId: 'modelo-disponible' }
        : { total: 2, unloaded: 1, failed: [{ instanceId: 'otro-modelo', message: 'Fallo' }] })
    })
  })

  try {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/settings')
    const llm = page.getByTestId('llm-settings')
    const preload = llm.getByRole('button', { name: 'Precargar modelo' })
    const unload = llm.getByRole('button', { name: 'Descargar todos de memoria' })
    await expect(preload).toBeVisible()
    await expect(unload).toBeVisible()
    await llm.getByRole('button', { name: 'Probar conexión' }).click()
    await expect(llm.getByText('El modelo configurado no está disponible. Selecciona uno de la lista.'))
      .toBeVisible()
    await expect(llm.getByLabel('Modelo')).toHaveValue('modelo-ausente')
    await expect(preload).toBeDisabled()

    await llm.getByLabel('Modelo').selectOption('modelo-disponible')
    await expect(preload).toBeEnabled()
    await preload.click()
    await expect(llm.getByRole('status')).toContainText('Modelo cargado en LM Studio.')
    expect(actions).toEqual(['load:normal'])

    await unload.click()
    const confirmation = page.getByRole('alertdialog')
    await expect(confirmation).toContainText('otras aplicaciones o usuarios')
    await confirmation.getByRole('button', { name: 'Cancelar' }).click()
    expect(actions).toEqual(['load:normal'])
    await unload.click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Descargar todos' }).click()
    await expect(llm.getByRole('status')).toContainText('1 de 2 instancias descargadas de memoria.')
    await expect(llm.getByRole('alert')).toContainText('otro-modelo')
    expect(actions).toEqual(['load:normal', 'unload-all:normal'])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.setViewportSize({ width: 1024, height: 768 })
    await expect(preload).toBeVisible()
    await expect(unload).toBeVisible()
  } finally {
    await data.patchSettings({ model: initial.model, useChromeLlm: initial.useChromeLlm })
  }
})

test('navega por secciones de Ajustes en desktop y conserva móvil sin overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 })
  await page.goto('/settings')

  const nav = page.getByTestId('settings-section-nav')
  await expect(nav).toBeVisible()
  await expect(nav.getByRole('link')).toHaveCount(8)
  expect(await nav.getByRole('link').evaluateAll(links =>
    links.map(link => link.getAttribute('data-settings-section'))
  )).toEqual([
    'apariencia',
    'protagonista',
    'usuarios',
    'llm',
    'prompt-narrativo',
    'swarmui',
    'actualizaciones',
    'datos'
  ])
  expect(await page.locator('.settings-page > section').evaluateAll(sections =>
    sections.map(section => section.id)
  )).toEqual([
    'apariencia',
    'protagonista',
    'usuarios',
    'llm',
    'prompt-narrativo',
    'swarmui',
    'actualizaciones',
    'datos'
  ])
  await expect(nav.getByRole('link', { name: 'Apariencia' }))
    .toHaveAttribute('aria-current', 'location')

  const protagonistLink = nav.getByRole('link', { name: 'Protagonista' })
  const protagonistBox = await protagonistLink.boundingBox()
  expect(protagonistBox).not.toBeNull()
  expect(await nav.evaluate(element => element.scrollWidth)).toBeGreaterThan(
    await nav.evaluate(element => element.clientWidth)
  )
  const initialUrl = page.url()
  const initialScrollLeft = await nav.evaluate(element => element.scrollLeft)
  await page.mouse.move(
    protagonistBox!.x + protagonistBox!.width / 2,
    protagonistBox!.y + protagonistBox!.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(
    protagonistBox!.x + protagonistBox!.width / 2 - 120,
    protagonistBox!.y + protagonistBox!.height / 2,
    { steps: 5 }
  )
  await page.mouse.up()
  await expect.poll(() => nav.evaluate(element => element.scrollLeft))
    .toBeGreaterThan(initialScrollLeft)
  await expect(page).toHaveURL(initialUrl)

  await nav.evaluate(element => { element.scrollLeft = 0 })
  await protagonistLink.click()
  await expect(page).toHaveURL(/\/settings#protagonista$/)
  await expect(protagonistLink).toHaveAttribute('aria-current', 'location')

  const swarmLink = nav.locator('[data-settings-section="swarmui"]')
  await swarmLink.click()
  await expect(page).toHaveURL(/\/settings#swarmui$/)
  await expect(swarmLink).toHaveAttribute('aria-current', 'location')

  await page.getByRole('button', { name: 'Prompts SwarmUI', exact: true }).click()
  await expect(page).toHaveURL(/\/settings#prompts-swarmui$/)
  await expect(page.getByRole('dialog', { name: 'Prompts SwarmUI' })).toBeVisible()
  await expect(swarmLink).toHaveAttribute('aria-current', 'location')

  await page.goBack()
  await expect(page).toHaveURL(/\/settings#swarmui$/)
  await expect(page.getByRole('dialog', { name: 'Prompts SwarmUI' })).toBeHidden()

  await page.goForward()
  await expect(page).toHaveURL(/\/settings#prompts-swarmui$/)
  await expect(page.getByRole('dialog', { name: 'Prompts SwarmUI' })).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/\/settings#swarmui$/)

  const dataLink = nav.locator('[data-settings-section="datos"]')
  await dataLink.click()
  await expect(page).toHaveURL(/\/settings#datos$/)
  await expect(dataLink).toHaveAttribute('aria-current', 'location')

  await page.goBack()
  await expect(page).toHaveURL(/\/settings#swarmui$/)
  await expect(swarmLink).toHaveAttribute('aria-current', 'location')

  await page.goForward()
  await expect(page).toHaveURL(/\/settings#datos$/)
  await expect(nav.getByRole('link', { name: 'Datos' }))
    .toHaveAttribute('aria-current', 'location')

  await page.setViewportSize({ width: 640, height: 720 })
  await page.locator('main').evaluate(element => {
    element.scrollTop = element.scrollHeight
  })
  await expect(nav.getByRole('link', { name: 'Datos' }))
    .toHaveAttribute('aria-current', 'location')
  await expect.poll(() => nav.evaluate((element) => {
    const active = element.querySelector<HTMLElement>('[aria-current="location"]')
    if (!active) return false
    const navRect = element.getBoundingClientRect()
    const activeRect = active.getBoundingClientRect()
    return activeRect.left >= navRect.left && activeRect.right <= navRect.right
  })).toBe(true)

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 })
    await expect(nav).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
})

test('previsualiza y confirma reasignación Access sin overflow', async ({ page }) => {
  const accessSession = {
    multiUserEnabled: true,
    identity: { id: 'new-admin-sub', email: 'admin@example.com' },
    isAdmin: true,
    canActivate: false
  }
  const preview = {
    source: { id: 'old-admin-sub', email: 'admin@example.com' },
    destination: accessSession.identity,
    affected: {
      normal: {
        characters: 2,
        imageBlobs: 2,
        images: 2,
        backgrounds: 1,
        sounds: 1,
        stories: 1,
        messages: 3,
        llmDebugTraces: 1,
        storySaves: 1,
        presets: 1,
        swarmPrompts: 1
      },
      private: {
        characters: 1,
        imageBlobs: 1,
        images: 1,
        backgrounds: 1,
        sounds: 0,
        stories: 1,
        messages: 2,
        llmDebugTraces: 0,
        storySaves: 1,
        presets: 0,
        swarmPrompts: 0
      },
      userSettings: 1,
      total: 24
    },
    movesAdministrator: true,
    fingerprint: 'preview-fingerprint'
  }
  let reassignmentBody: Record<string, unknown> | null = null
  await page.route('**/api/access', route => route.fulfill({ json: accessSession }))
  await page.route('**/api/access/reassign/preview', async (route) => {
    const body = route.request().postDataJSON() as typeof preview
    expect(body.source).toEqual(preview.source)
    expect(body.destination).toEqual(preview.destination)
    await route.fulfill({ json: preview })
  })
  await page.route('**/api/access/reassign', async (route) => {
    reassignmentBody = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      json: {
        auditId: 'audit-172',
        completedAt: Date.now(),
        preview
      }
    })
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/settings#usuarios')
  const panel = page.getByTestId('identity-reassignment')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Recuperación del administrador')
  await page.getByLabel('Sub anterior').fill(preview.source.id)
  await page.getByLabel('Email anterior').fill(preview.source.email)
  await page.getByRole('button', { name: 'Previsualizar' }).click()

  const summary = page.getByTestId('identity-reassignment-preview')
  await expect(summary).toContainText('24 registros afectados')
  await expect(summary).toContainText('2 personajes')
  await expect(summary).toContainText('1 partidas')
  await expect(summary).toContainText('administración de la instancia')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await page.setViewportSize({ width: 320, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.getByRole('button', { name: 'Confirmar reasignación' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Reasignar identidad Access' })
  await expect(dialog).toContainText('old-admin-sub')
  await dialog.getByRole('button', { name: 'Reasignar' }).click()
  await expect(panel.getByRole('status')).toContainText('audit-172')
  expect(reassignmentBody).toMatchObject({
    source: preview.source,
    destination: preview.destination,
    fingerprint: preview.fingerprint
  })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})

for (const width of [320, 390]) {
  test(`oculta navegación global al bajar y muestra solo iconos al subir a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 })
    await page.goto('/settings')

    const main = page.locator('main')
    const navigation = page.locator('#app-navigation')
    const navigationLinks = page.getByTestId('app-navigation-links')
    const brand = page.getByTestId('app-brand')
    await expect(brand).toBeVisible()
    await expect(navigationLinks).toBeVisible()

    await main.evaluate((element) => { element.scrollTop = 240 })
    await expect(navigation).toBeHidden()

    await main.evaluate((element) => { element.scrollTop = 180 })
    await expect(navigationLinks).toBeVisible()
    await expect(brand).toBeHidden()

    await main.evaluate((element) => { element.scrollTop = 0 })
    await expect(brand).toBeVisible()
    await expect(navigationLinks).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
}

test('autoguarda apariencia, modo prueba y velocidad', async ({ page, data }) => {
  const userName = data.unique('Protagonista')
  await data.patchSettings({ theme: 'system', mockMode: false, responseSpeed: 'high' })

  await page.goto('/settings')
  await page.getByRole('button', { name: 'Modo oscuro' }).click()
  await page.getByRole('checkbox', { name: /Modo prueba \(sin LLM\)/ }).check()
  await page.getByLabel('Velocidad de escritura').selectOption('instant')
  await page.getByPlaceholder('Protagonista', { exact: true }).fill(userName)
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

test('guarda cambios del protagonista en el modo de origen sin pisar valores del otro', async ({ page, data }) => {
  const normalName = data.unique('Nombre normal')
  const normalDescription = data.unique('Descripción normal')
  const privateName = data.unique('Nombre privado')
  const privateDescription = data.unique('Descripción privada')
  await data.patchSettings({
    userName: 'Nombre inicial',
    protagonistPreferences: 'Descripción inicial',
    privateUserName: privateName,
    privateProtagonistPreferences: privateDescription
  })

  await page.goto('/settings#protagonista')
  await page.locator('#userName').fill(normalName)
  await page.locator('#protagonistPreferences').fill(normalDescription)
  await page.locator('main').press('Control+Alt+p')

  await expect(page.locator('html')).toHaveClass(/private-scope/)
  await expect(page.getByRole('button', { name: 'Alternar modo demo' })).toBeEnabled()
  await expect(page.locator('#userName')).toHaveValue(privateName)
  await expect(page.locator('#protagonistPreferences')).toHaveValue(privateDescription)
  let saved = await (await page.request.get('/api/settings')).json() as AppSettings
  expect(saved).toMatchObject({
    userName: normalName,
    protagonistPreferences: normalDescription,
    privateUserName: privateName,
    privateProtagonistPreferences: privateDescription
  })

  const changedPrivateName = data.unique('Nuevo nombre privado')
  const changedPrivateDescription = data.unique('Nueva descripción privada')
  await page.locator('#userName').fill(changedPrivateName)
  await page.locator('#protagonistPreferences').fill(changedPrivateDescription)
  await page.locator('main').press('Control+Alt+p')

  await expect(page.locator('html')).not.toHaveClass(/private-scope/)
  await expect(page.locator('#userName')).toHaveValue(normalName)
  await expect(page.locator('#protagonistPreferences')).toHaveValue(normalDescription)
  saved = await (await page.request.get('/api/settings')).json() as AppSettings
  expect(saved).toMatchObject({
    userName: normalName,
    protagonistPreferences: normalDescription,
    privateUserName: changedPrivateName,
    privateProtagonistPreferences: changedPrivateDescription
  })
})

test('cada campo privado sin valor propio hereda el normal actualizado', async ({ page, data }) => {
  const normalName = data.unique('Nombre heredado')
  const privateDescription = data.unique('Descripción propia')
  await data.patchSettings({
    userName: 'Nombre inicial',
    protagonistPreferences: 'Descripción inicial',
    privateUserName: null,
    privateProtagonistPreferences: privateDescription
  })

  await page.goto('/settings#protagonista')
  await page.locator('#userName').fill(normalName)
  await page.locator('main').press('Control+Alt+p')

  await expect(page.locator('#userName')).toHaveValue(normalName)
  await expect(page.locator('#protagonistPreferences')).toHaveValue(privateDescription)
  const saved = await (await page.request.get('/api/settings')).json() as AppSettings
  expect(saved.privateUserName).toBeNull()
  expect(saved.privateProtagonistPreferences).toBe(privateDescription)
})

test('alterna modo privado con Ctrl+Alt+P sin cambiar URL ni interrumpir inputs', async ({ page }) => {
  await page.goto('/settings')

  await page.getByPlaceholder('Protagonista', { exact: true }).focus()
  await page.keyboard.press('Control+Alt+p')
  await expect(page.locator('html')).not.toHaveClass(/private-scope/)

  await page.locator('main').press('Control+Alt+p')
  await expect(page).toHaveURL('/settings')
  await expect(page.locator('html')).toHaveClass(/private-scope/)
  await expect(page.getByRole('button', { name: 'Salir del modo privado' })).toHaveCount(0)
  const privateTrigger = page.getByRole('button', { name: 'Activar modo privado' })
  const demoTrigger = page.getByRole('button', { name: 'Alternar modo demo' })
  await expect(demoTrigger).toBeEnabled()
  await page.locator('main').press('Control+Alt+p')
  await expect(page.locator('html')).not.toHaveClass(/private-scope/)
  await expect(page).toHaveURL('/settings')

  await expect(privateTrigger).toBeEnabled()
  await page.locator('main').press('Control+Alt+d')
  await expect(page.locator('html')).toHaveClass(/demo-scope/)
  await expect(demoTrigger).toBeEnabled()
  await page.locator('main').press('Control+Alt+p')
  await expect(page.locator('html')).toHaveClass(/private-scope/)
  await expect(page.locator('html')).not.toHaveClass(/demo-scope/)
  await expect(demoTrigger).toBeEnabled()
  await page.locator('main').press('Control+Alt+p')
  await expect(page.locator('html')).not.toHaveClass(/private-scope|demo-scope/)
  await expect(privateTrigger).toBeEnabled()
})

test('sincroniza ajustes y resultados de LM Studio en cada cambio de modo', async ({ page, data }) => {
  await data.patchSettings({
    useChromeLlm: false,
    privateUseChromeLlm: true,
    baseUrl: 'http://normal.test',
    model: 'normal-model',
    privateLlmSettingsEnabled: true,
    privateBaseUrl: 'http://private.test',
    privateModel: 'private-model'
  })
  await page.route('**/api/llm/models?**', async (route) => {
    await route.fulfill({ json: ['normal-only-model'] })
  })

  await page.goto('/settings#llm')
  const main = page.locator('main')
  const chrome = page.getByRole('checkbox', { name: /Usar IA local de Chrome/ })
  await expect(chrome).not.toBeChecked()
  await expect(page.locator('#baseUrl')).toHaveValue('http://normal.test')
  await page.getByTestId('llm-settings').getByRole('button', { name: 'Probar conexión' }).click()
  await expect(page.getByText('1 modelos disponibles')).toBeVisible()
  await expect(page.locator('select#model')).toBeVisible()

  await main.press('Control+Alt+p')
  await expect(page).toHaveURL('/settings#llm')
  await expect(chrome).toBeChecked()
  await expect(page.locator('#baseUrl')).toHaveValue('http://private.test')
  await expect(page.locator('#model')).toHaveValue('private-model')
  await expect(page.getByText('1 modelos disponibles')).toHaveCount(0)
  await expect(page.locator('input#model')).toBeVisible()

  await expect(page.getByRole('button', { name: 'Alternar modo demo' })).toBeEnabled()
  await main.press('Control+Alt+d')
  await expect(page.locator('html')).toHaveClass(/demo-scope/)
  await expect(chrome).toBeChecked()
  await expect(page.getByRole('button', { name: 'Alternar modo demo' })).toBeEnabled()
  await main.press('Control+Alt+d')
  await expect(page.locator('html')).not.toHaveClass(/private-scope|demo-scope/)
  await expect(chrome).not.toBeChecked()
  await expect(page.locator('#baseUrl')).toHaveValue('http://normal.test')
})

test('guarda y cierra Prompts SwarmUI al cambiar de modo', async ({ page, data }) => {
  await data.patchSettings({ swarmBaseUrl: 'http://localhost:7801' })
  await page.goto('/settings#prompts-swarmui')
  const dialog = page.getByRole('dialog', { name: 'Prompts SwarmUI' })
  const promptSettings = page.getByTestId('swarm-prompt-settings')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Nuevo prompt', exact: true }).click()
  const name = data.unique('Prompt al cambiar de modo')
  await promptSettings.getByLabel('Nombre', { exact: true }).fill(name)
  await promptSettings.getByLabel('Prompt', { exact: true }).fill('Escena del modo normal')
  const scrollTop = await page.locator('main').evaluate(element => element.scrollTop)

  await dialog.getByRole('button', { name: 'Cerrar diálogo' }).focus()
  await page.keyboard.press('Control+Alt+p')
  await expect(page.locator('html')).toHaveClass(/private-scope/)
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL('/settings#swarmui')
  await expect.poll(() => page.locator('main').evaluate(element => element.scrollTop)).toBe(scrollTop)
  expect((await data.list<{ name: string }>('swarmPrompts', 'normal'))
    .some(prompt => prompt.name === name)).toBe(true)

  await page.getByRole('button', { name: 'Prompts SwarmUI', exact: true }).click()
  await expect(dialog).toBeVisible()
  await expect(promptSettings.getByLabel('Nombre', { exact: true })).toHaveValue('')
})

test('mantiene el modo y el diálogo si falla el guardado antes del cambio', async ({ page, data }) => {
  await data.patchSettings({ swarmBaseUrl: 'http://localhost:7801' })
  await page.goto('/settings#prompts-swarmui')
  const dialog = page.getByRole('dialog', { name: 'Prompts SwarmUI' })
  await expect(dialog).toBeVisible()
  await page.route('**/api/data/swarmPrompts/**', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 500, body: 'Fallo de prueba' })
    } else {
      await route.continue()
    }
  })
  await dialog.getByRole('button', { name: 'Nuevo prompt', exact: true }).click()
  const promptSettings = page.getByTestId('swarm-prompt-settings')
  await promptSettings.getByLabel('Nombre', { exact: true }).fill(data.unique('Prompt fallido'))
  await promptSettings.getByLabel('Prompt', { exact: true }).fill('Este prompt no debe guardarse')
  await dialog.getByRole('button', { name: 'Cerrar diálogo' }).focus()
  await page.keyboard.press('Control+Alt+p')

  await expect(page.locator('html')).not.toHaveClass(/private-scope/)
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL('/settings#prompts-swarmui')
  await expect(promptSettings.getByRole('alert')).toBeVisible()
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
  await expect(page).toHaveURL('/settings')
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
  await expect(page).toHaveURL('/settings')
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
  const tokenInput = page.getByLabel('Token de acceso (opcional)')
  await expect(tokenInput).toHaveValue('')
  await expect(tokenInput).toHaveAttribute('placeholder', '****')

  await baseUrl.fill('http://private.test')
  await model.fill('private-model')
  await page.getByLabel('Temperatura').fill('1.2')
  await page.getByLabel('Máx. tokens').fill('1200')
  await page.getByLabel('Historial (caracteres)').fill('7000')
  await tokenInput.fill('private-secret')
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
    apiKey: '',
    apiKeyConfigured: true,
    model: 'normal-model',
    privateLlmSettingsEnabled: true,
    privateBaseUrl: 'http://private.test',
    privateApiKey: '',
    privateApiKeyConfigured: true,
    privateModel: 'private-model',
    privateTemperature: 1.2,
    privateMaxTokens: 1200,
    privateHistoryBudget: 7000
  })
  await expect(tokenInput).toHaveValue('')
  await expect(tokenInput).toHaveAttribute('placeholder', '****')

  await customize.uncheck()
  await expect(baseUrl).toBeDisabled()
  await expect(baseUrl).toHaveValue('http://normal.test')
  await expect.poll(async () => {
    const response = await page.request.get('/api/settings')
    return ((await response.json()) as AppSettings).privateLlmSettingsEnabled
  }).toBe(false)
  await expect(tokenInput).toHaveValue('')
  await expect(tokenInput).toHaveAttribute('placeholder', '****')
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
  const existingRow = page.getByRole('listitem').filter({
    has: page.getByText(existing.name, { exact: true })
  })
  const backupList = page.getByTestId('backup-list')
  await expect(existingRow).toBeVisible()
  await expect(existingRow.getByText('Manual', { exact: true })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await existingRow.getByRole('link', { name: 'Descargar' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(existing.name)
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  const downloadedBackup = await readFile(downloadPath!)

  const uploadInput = page.getByTestId('backup-upload-input')
  await uploadInput.setInputFiles({
    name: 'incompatible.sqlite',
    mimeType: 'application/vnd.sqlite3',
    buffer: Buffer.from('no es SQLite')
  })
  await expect(page.getByRole('alert')).toContainText(
    'no es un backup SQLite válido de Mis Historias'
  )
  await expect(backupList.getByRole('listitem')).toHaveCount(1)

  await uploadInput.setInputFiles({
    name: existing.name,
    mimeType: 'application/vnd.sqlite3',
    buffer: downloadedBackup
  })
  await expect(page.getByText(/^Backup subido:/)).toBeVisible()
  const uploadedRow = page.getByRole('listitem').filter({ hasText: 'Subido' })
  await expect(uploadedRow).toBeVisible()
  await expect(uploadedRow.getByText('Subido', { exact: true })).toBeVisible()

  await page.setViewportSize({ width: 320, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await page.getByRole('button', { name: 'Crear backup' }).click()
  await expect(page.getByText(/^Backup creado:/)).toBeVisible()
  await expect(backupList.getByRole('listitem')).toHaveCount(3)

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

test('personaliza y revierte el prompt narrativo integrado', async ({ page, data }) => {
  await data.patchSettings({ narrativePrompt: null })
  await page.goto('/settings')
  const prompt = page.getByLabel('Prompt narrativo integrado')
  await expect(prompt).toHaveValue(DEFAULT_PRESET_CONTENT)
  await expect(prompt).toBeEditable()
  const revert = page.getByRole('button', { name: 'Revertir a prompt por defecto' })
  await expect(revert).toHaveCount(0)

  await prompt.fill('Prompt narrativo personalizado')
  await expect(revert).toBeVisible()
  await expect(page.getByText('Guardado', { exact: true })).toBeVisible()
  await expect.poll(async () => {
    const response = await page.request.get('/api/settings')
    return ((await response.json()) as AppSettings).narrativePrompt
  }).toBe('Prompt narrativo personalizado')

  await page.reload()
  await expect(prompt).toHaveValue('Prompt narrativo personalizado')
  await revert.click()
  await expect(prompt).toHaveValue(DEFAULT_PRESET_CONTENT)
  await expect(revert).toHaveCount(0)
  await expect.poll(async () => {
    const response = await page.request.get('/api/settings')
    return ((await response.json()) as AppSettings).narrativePrompt
  }).toBeNull()

  await expect(page.getByRole('link', { name: 'Prompts', exact: true })).toHaveCount(0)
  await page.goto('/prompts')
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
})

test('personaliza y revierte el prompt de referencia de personaje', async ({ page, data }) => {
  await data.patchSettings({ characterReferencePrompt: null })
  await page.goto('/settings')
  const trigger = page.getByRole('button', { name: 'Prompt de referencia', exact: true })
  await trigger.click()
  await expect(page).toHaveURL(/\/settings#prompt-referencia-personaje$/)
  const dialog = page.getByRole('dialog', { name: 'Prompt de referencia de personaje' })
  await expect(dialog).toBeVisible()
  const prompt = dialog.getByLabel('Prompt de referencia de personaje integrado')
  await expect(prompt).toHaveValue(DEFAULT_CHARACTER_REFERENCE_PROMPT)
  const revert = dialog.getByRole('button', { name: 'Revertir prompt de referencia por defecto' })
  await expect(revert).toHaveCount(0)

  await prompt.fill('Describe únicamente la identidad visible.')
  await expect(revert).toBeVisible()
  await expect(dialog.getByText('Guardado', { exact: true })).toBeVisible()
  await expect.poll(async () => {
    const response = await page.request.get('/api/settings')
    return ((await response.json()) as AppSettings).characterReferencePrompt
  }).toBe('Describe únicamente la identidad visible.')

  await dialog.getByRole('button', { name: 'Cerrar diálogo' }).click()
  await expect(page).toHaveURL(/\/settings#swarmui$/)
  await expect(trigger).toBeFocused()

  await page.goto('/settings#prompt-referencia-personaje')
  await expect(dialog).toBeVisible()
  await expect(prompt).toHaveValue('Describe únicamente la identidad visible.')
  await revert.click()
  await expect(prompt).toHaveValue(DEFAULT_CHARACTER_REFERENCE_PROMPT)
  await expect(revert).toHaveCount(0)
  await expect.poll(async () => {
    const response = await page.request.get('/api/settings')
    return ((await response.json()) as AppSettings).characterReferencePrompt
  }).toBeNull()
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
  await expect(page).toHaveURL('/settings')
  await page.getByRole('link', { name: 'Personajes' }).click()
  await expect(page.getByText(privateCharacter.name, { exact: true })).toBeVisible()
  await expect(page.getByText(normal.name, { exact: true })).toHaveCount(0)

  await page.locator('main').press('Control+Alt+p')
  await expect(page).toHaveURL('/characters')
  await page.getByRole('link', { name: 'Personajes' }).click()
  await expect(page.getByText(normal.name, { exact: true })).toBeVisible()
  await expect(page.getByText(privateCharacter.name, { exact: true })).toHaveCount(0)

  expect((await data.list<Character>('characters', 'normal')).some((item) => item.id === normal.id))
    .toBe(true)
  expect((await data.list<Character>('characters', 'private'))
    .some((item) => item.id === privateCharacter.id)).toBe(true)
})
