import { test, expect } from './fixtures'

const cookieName = 'mishistorias-mode'
const modes = [
  { mode: 'private', label: 'oculto', shortcut: 'Control+Alt+p', scopeClass: /private-scope/ },
  { mode: 'demo', label: 'demo', shortcut: 'Control+Alt+d', scopeClass: /demo-scope/ }
] as const

test('normal no ofrece recordar modos e ignora cookies inválidas', async ({ page, context }) => {
  await context.addCookies([{ name: cookieName, value: 'invalid', url: 'http://localhost:3069' }])
  await page.goto('/settings')
  await expect(page.locator('html')).not.toHaveClass(/private-scope|demo-scope/)
  await expect(page.getByRole('button', { name: /Mantener modo|Olvidar modo/ })).toHaveCount(0)
  await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === cookieName)).toBeUndefined()
})

for (const { mode, label, shortcut, scopeClass } of modes) {
  const keepName = 'Mantener modo ' + label
  const forgetName = 'Olvidar modo ' + label

  test('modo ' + label + ' sin recuerdo vuelve a normal al recargar', async ({ page, context }) => {
    await page.goto('/settings')
    await page.locator('main').press(shortcut)
    await expect(page.locator('html')).toHaveClass(scopeClass)
    await expect(page.getByRole('button', { name: keepName, exact: true })).toBeVisible()
    expect((await context.cookies()).find(cookie => cookie.name === cookieName)).toBeUndefined()
    await page.reload()
    await expect(page.locator('html')).not.toHaveClass(/private-scope|demo-scope/)
  })

  test('recuerda modo ' + label + ' al recargar y abrir otra pestaña con el ámbito correcto', async ({ page, context, data }) => {
    const normal = await data.createCharacter({ name: data.unique('Normal') })
    const visible = await data.createCharacter({
      name: data.unique('Visible'), scope: 'private', visibleInDemo: true
    })
    const hidden = await data.createCharacter({ name: data.unique('Oculto'), scope: 'private' })
    await page.goto('/settings')
    await page.locator('main').press(shortcut)
    await page.getByRole('button', { name: keepName, exact: true }).click()
    await expect(page.getByRole('button', { name: forgetName, exact: true })).toBeVisible()
    const cookie = (await context.cookies()).find(cookie => cookie.name === cookieName)!
    expect(cookie.value).toBe(mode)
    expect(cookie.path).toBe('/')
    expect(cookie.sameSite).toBe('Lax')
    expect(cookie.expires - Date.now() / 1000).toBeGreaterThan(365 * 24 * 60 * 60 - 60)
    expect(cookie.expires - Date.now() / 1000).toBeLessThanOrEqual(365 * 24 * 60 * 60)
    await page.reload()
    await expect(page.locator('html')).toHaveClass(scopeClass)
    await expect(page.getByRole('button', { name: forgetName, exact: true })).toBeVisible()

    const newPage = await context.newPage()
    const scopes: Array<string | null> = []
    newPage.on('request', request => {
      const url = new URL(request.url())
      if (url.pathname === '/api/data/characters') scopes.push(url.searchParams.get('scope'))
    })
    await newPage.goto('/characters')
    await expect(newPage.locator('html')).toHaveClass(scopeClass)
    await expect(newPage.getByText(visible.name, { exact: true })).toBeVisible()
    await expect(newPage.getByText(normal.name, { exact: true })).toHaveCount(0)
    await expect(newPage.getByText(hidden.name, { exact: true })).toHaveCount(mode === 'private' ? 1 : 0)
    expect(scopes.length).toBeGreaterThan(0)
    expect(scopes.every(scope => scope === 'private')).toBe(true)
    await newPage.close()
  })

  test('olvidar modo ' + label + ' conserva sesión y elimina recuerdo', async ({ page, context }) => {
    await page.goto('/settings')
    await page.locator('main').press(shortcut)
    await page.getByRole('button', { name: keepName, exact: true }).click()
    await page.getByRole('button', { name: forgetName, exact: true }).click()
    await expect(page.locator('html')).toHaveClass(scopeClass)
    await expect(page.getByRole('button', { name: keepName, exact: true })).toBeVisible()
    await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === cookieName)).toBeUndefined()
    await page.reload()
    await expect(page.locator('html')).not.toHaveClass(/private-scope|demo-scope/)
  })

  for (const nextMode of ['normal', mode === 'private' ? 'demo' : 'private'] as const) {
    test('salir de ' + mode + ' hacia ' + nextMode + ' elimina recuerdo', async ({ page, context }) => {
      await page.goto('/settings')
      await page.locator('main').press(shortcut)
      await page.getByRole('button', { name: keepName, exact: true }).click()
      const nextShortcut = nextMode === 'normal' ? shortcut : nextMode === 'demo' ? 'Control+Alt+d' : 'Control+Alt+p'
      await page.locator('main').press(nextShortcut)
      await expect(page.locator('html')).not.toHaveClass(scopeClass)
      await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === cookieName)).toBeUndefined()
      if (nextMode !== 'normal') {
        const nextLabel = nextMode === 'demo' ? 'demo' : 'oculto'
        await expect(page.getByRole('button', { name: 'Mantener modo ' + nextLabel, exact: true })).toBeVisible()
      }
      await page.reload()
      await expect(page.locator('html')).not.toHaveClass(/private-scope|demo-scope/)
    })
  }
}

test('guardado fallido conserva modo recordado y cookie', async ({ page, context }) => {
  await page.goto('/settings')
  await page.locator('main').press('Control+Alt+p')
  await page.getByRole('button', { name: 'Mantener modo oculto', exact: true }).click()
  await page.route('**/api/settings', async route => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ status: 500, body: 'Fallo de prueba' })
    } else {
      await route.continue()
    }
  })
  await page.locator('#userName').fill('Nombre que no puede guardarse')
  await page.locator('main').press('Control+Alt+p')
  await expect(page.locator('main header [aria-live="polite"]')).toContainText('500 Internal Server Error')
  await expect(page.locator('html')).toHaveClass(/private-scope/)
  expect((await context.cookies()).find(cookie => cookie.name === cookieName)?.value).toBe('private')
})

for (const { mode, label, shortcut, scopeClass } of modes) {
  test('controles de recuerdo del modo ' + label + ' sin desbordamiento ni solapamientos', async ({ page }) => {
    const sectionId = mode === 'private' ? 'apariencia' : 'datos'
    await page.goto('/settings#' + sectionId)
    await page.locator('main').press(shortcut)
    await expect(page.locator('html')).toHaveClass(scopeClass)
    for (const remembered of [false, true]) {
      const button = page.getByRole('button', {
        name: (remembered ? 'Olvidar' : 'Mantener') + ' modo ' + label, exact: true
      })
      for (const width of [320, 390, 768, 1280]) {
        await page.setViewportSize({ width, height: 850 })
        await button.scrollIntoViewIfNeeded()
        await expect(button).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        const bounds = (await button.boundingBox())!
        const section = (await page.locator('#' + sectionId).boundingBox())!
        expect(bounds.x).toBeGreaterThanOrEqual(section.x)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(section.x + section.width)
        const nearbyNames = mode === 'private' ? ['Sistema', 'Modo claro', 'Modo oscuro'] : ['Exportar JSON', 'Importar JSON']
        for (const name of nearbyNames) {
          const nearby = (await page.getByRole('button', { name, exact: true }).boundingBox())!
          if (mode === 'demo') expect(nearby.height).toBeLessThanOrEqual(48)
          const overlaps = bounds.x < nearby.x + nearby.width && bounds.x + bounds.width > nearby.x
            && bounds.y < nearby.y + nearby.height && bounds.y + bounds.height > nearby.y
          expect(overlaps).toBe(false)
        }
        if (remembered && (width === 390 || width === 1280)) {
          await page.screenshot({ path: '.data/issue-245-' + mode + '-' + width + '.png' })
        }
      }
      if (!remembered) await button.click()
    }
  })
}
