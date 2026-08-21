import { expect, test } from '@playwright/test'

test.describe('NSFW auth M0', () => {
  test('bootstrap o login, admin CRUD y logout', async ({ page, request }) => {
    const { ensureNsfwAuth } = await import('./helpers/nsfwAuth')
    const suffix = Date.now()
    const regularUser = `user-${suffix}`
    const regularPass = 'user-pass-12345'

    await ensureNsfwAuth(request)
    const state = await request.storageState()
    if (state.cookies.length) await page.context().addCookies(state.cookies)

    await page.goto('/private/admin/users', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Usuarios' })).toBeVisible({ timeout: 20_000 })

    await page.getByPlaceholder('Usuario').fill(regularUser)
    await page.getByPlaceholder('Contraseña').fill(regularPass)
    await page.getByRole('button', { name: 'Crear' }).click()
    await expect(page.getByText(regularUser)).toBeVisible()

    const listed = await request.get('/api/private/admin/users')
    expect(listed.ok()).toBeTruthy()
    const body = (await listed.json()) as { users: Array<{ username: string }> }
    expect(body.users.some((u) => u.username === regularUser)).toBeTruthy()

    await page.getByRole('button', { name: 'Salir' }).first().click()
    await expect(page).toHaveURL('/private/login')

    await page.getByLabel('Usuario').fill(regularUser)
    await page.getByLabel('Contraseña', { exact: true }).fill(regularPass)
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).toHaveURL(/\/private(\/|$)/)
    await expect(page.getByText(regularUser).first()).toBeVisible()
  })

  test('trigger oculto navega al gate NSFW sin filtrar contenido', async ({ page }) => {
    // Cubierto también en stories.spec; aquí vía settings con force (opacity-0)
    await page.goto('/settings', { waitUntil: 'networkidle' }).catch(async () => {
      await page.goto('/settings', { waitUntil: 'domcontentloaded' })
    })
    // Si settings 500, fallback a historia inexistente
    const onSettings = page.url().includes('/settings')
    if (onSettings && !(await page.locator('button[aria-label="Activar modo privado"]').count())) {
      await page.goto('/stories/historia-inexistente')
    }
    if (page.url().includes('historia-inexistente')) {
      const trigger = page.getByTestId('missing-story-private-trigger')
      await expect(trigger).toBeVisible({ timeout: 15_000 })
      await trigger.click()
      await trigger.click()
      await trigger.click()
    } else {
      const trigger = page.locator('button[aria-label="Activar modo privado"]')
      await expect(trigger).toBeAttached({ timeout: 15_000 })
      await trigger.click({ clickCount: 3, delay: 80, force: true })
    }
    await expect(page).toHaveURL('/private/login')
    await expect(page.locator('html')).toHaveClass(/nsfw-scope/)
  })

  test('rutas privadas redirigen sin sesión', async ({ page }) => {
    await page.goto('/private/library')
    await expect(page).toHaveURL('/private/login')
  })
})
