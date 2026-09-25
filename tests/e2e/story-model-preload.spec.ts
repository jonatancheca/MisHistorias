import type { Message } from '../../shared/types'
import { expect, test } from './fixtures'

test('precarga LM Studio al abrir el formulario y espera antes de generar', async ({ page, data }) => {
  const character = await data.createCharacter()
  await data.patchSettings({ mockMode: false, useChromeLlm: false, model: 'modelo-historia' })
  const releaseLoad = Promise.withResolvers<undefined>()
  const loadRequested = Promise.withResolvers<undefined>()
  let chatRequests = 0

  await page.route('**/api/llm/model-management', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ action: 'load', scope: 'normal' })
    loadRequested.resolve(undefined)
    await releaseLoad.promise
    await route.fulfill({ json: { status: 'loaded', instanceId: 'modelo-historia' } })
  })
  await page.route('**/api/llm/chat', async (route) => {
    chatRequests += 1
    await route.fulfill({ json: { content: 'Narrador: La aventura comienza.', finishReason: 'stop' } })
  })

  try {
    await page.goto('/')
    await page.getByRole('link', { name: 'Nueva historia' }).click()
    await loadRequested.promise
    await expect(page.getByTestId('story-model-preload')).toContainText('Cargando modelo')
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }
    await page.getByLabel('Planteamiento').fill('Una aventura de prueba.')
    await page.getByRole('button', { name: 'Añadir personaje' }).click()
    await page.getByRole('dialog', { name: 'Añadir personaje' })
      .getByRole('button', { name: `Añadir ${character.name} al elenco` }).click()
    await page.getByRole('button', { name: 'Empezar historia' }).click()
    await expect(page).toHaveURL(/\/stories\/[^/]+$/)
    await expect(page.getByTestId('story-model-preload')).toContainText('Cargando modelo')
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }
    await page.getByRole('button', { name: 'Deja que la história empiece sola' }).click()
    await expect(page.getByTestId('story-model-preload')).toBeVisible()
    expect(chatRequests).toBe(0)
    await page.getByRole('button', { name: 'Parar' }).click()
    await expect(page.getByRole('button', { name: 'Deja que la história empiece sola' })).toBeVisible()
    expect(chatRequests).toBe(0)
    await page.getByRole('button', { name: 'Deja que la história empiece sola' }).click()

    releaseLoad.resolve(undefined)
    await expect.poll(() => chatRequests).toBe(1)
    const storyId = new URL(page.url()).pathname.split('/').pop()!
    await expect.poll(async () => (await data.list<Message>('messages', 'normal', { storyId }))
      .some((message) => message.role === 'assistant')).toBe(true)
    await expect(page.getByTestId('story-model-preload')).toHaveCount(0)
  } finally {
    releaseLoad.resolve(undefined)
  }
})

test('un error de precarga no impide crear ni generar la historia', async ({ page, data }) => {
  const character = await data.createCharacter()
  await data.patchSettings({ mockMode: false, useChromeLlm: false, model: 'modelo-historia' })
  let chatRequests = 0
  await page.route('**/api/llm/model-management', (route) => route.fulfill({
    status: 502,
    json: { message: 'LM Studio desconectado' }
  }))
  await page.route('**/api/llm/chat', async (route) => {
    chatRequests += 1
    await route.fulfill({ json: { content: 'Narrador: La aventura comienza.', finishReason: 'stop' } })
  })

  await page.goto('/stories/new')
  await expect(page.getByTestId('story-model-preload')).toContainText('LM Studio desconectado')
  await expect(page.getByTestId('story-model-preload')).toHaveAttribute('role', 'alert')
  await page.getByLabel('Planteamiento').fill('Una aventura de prueba.')
  await page.getByRole('button', { name: 'Añadir personaje' }).click()
  await page.getByRole('dialog', { name: 'Añadir personaje' })
    .getByRole('button', { name: `Añadir ${character.name} al elenco` }).click()
  await page.getByRole('button', { name: 'Empezar historia' }).click()
  await expect(page).toHaveURL(/\/stories\/[^/]+$/)
  await page.getByRole('button', { name: 'Deja que la história empiece sola' }).click()
  await expect.poll(() => chatRequests).toBe(1)
  const storyId = new URL(page.url()).pathname.split('/').pop()!
  await expect.poll(async () => (await data.list<Message>('messages', 'normal', { storyId }))
    .some((message) => message.role === 'assistant')).toBe(true)
  await expect(page.getByTestId('story-model-preload')).toHaveCount(0)
})

test('al cambiar a privado precarga el modelo del nuevo ámbito', async ({ page, data }) => {
  await data.patchSettings({
    mockMode: false,
    useChromeLlm: false,
    model: 'modelo-normal',
    privateLlmSettingsEnabled: true,
    privateModel: 'modelo-privado'
  })
  const scopes: string[] = []
  await page.route('**/api/llm/model-management', async (route) => {
    const body = route.request().postDataJSON() as { action: string; scope: string }
    scopes.push(`${body.action}:${body.scope}`)
    await route.fulfill({ json: { status: 'loaded', instanceId: body.scope } })
  })

  await page.goto('/stories/new')
  await expect.poll(() => scopes).toEqual(['load:normal'])
  await page.keyboard.press('Control+Alt+p')
  await expect(page.locator('html')).toHaveClass(/private-scope/)
  await expect.poll(() => scopes).toEqual(['load:normal', 'load:private'])
  await expect(page.getByTestId('story-model-preload')).toContainText('Modelo de LM Studio cargado.')
})

test('omite la precarga con Chrome, modo de prueba y usuarios no administradores', async ({ page, data }) => {
  let loads = 0
  async function expectNoPreload() {
    const chat = page.getByRole('button', { name: /Chat/ })
    await chat.click()
    await expect(chat).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('story-model-preload')).toHaveCount(0)
    expect(loads).toBe(0)
  }
  await page.route('**/api/llm/model-management', async (route) => {
    loads += 1
    await route.fulfill({ json: { status: 'loaded', instanceId: 'modelo-historia' } })
  })

  await data.patchSettings({ mockMode: false, useChromeLlm: true, model: 'modelo-historia' })
  await page.goto('/stories/new')
  await expectNoPreload()

  await data.patchSettings({ mockMode: true, useChromeLlm: false })
  await page.reload()
  await expectNoPreload()

  await data.patchSettings({ mockMode: false })
  await page.route('**/api/access', (route) => route.fulfill({ json: {
    multiUserEnabled: true,
    identity: { id: 'visitor-sub', email: 'visitante@example.com' },
    isAdmin: false,
    canActivate: false
  } }))
  await page.reload()
  await expectNoPreload()
})
