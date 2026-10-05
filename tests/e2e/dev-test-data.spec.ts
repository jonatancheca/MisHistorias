import { test, expect } from './fixtures'

test('semilla configura LM Studio de desarrollo y actualiza ajustes sin recargar', async ({ page, data }) => {
  await data.patchSettings({ baseUrl: 'http://anterior:1234', model: 'modelo-anterior', apiKey: 'token-de-pruebas',
    privateLlmSettingsEnabled: true, privateBaseUrl: 'http://privado:1234', privateModel: 'modelo-privado' })
  await page.route('**/api/llm/capacity?*', route => route.fulfill({ json: { capacity: 30208, model: 'qwen3.8-27b' } }))
  await page.goto('/dev/test-data')
  await page.getByRole('button', { name: 'Limpiar y cargar datos de prueba', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Limpieza y semilla completadas' })).toBeVisible()
  expect(await (await page.request.get('/api/settings')).json()).toMatchObject({
    baseUrl: 'http://jona-pc-25:1234', model: 'qwen3.8-27b', apiKeyConfigured: false,
    privateBaseUrl: 'http://privado:1234', privateModel: 'modelo-privado'
  })
  await page.getByRole('link', { name: 'Ajustes', exact: true }).click()
  await page.locator('[data-settings-section="llm"]').click()
  await expect(page.getByLabel('URL del servidor (LMStudio)', { exact: true })).toHaveValue('http://jona-pc-25:1234')
  await expect(page.getByLabel('Modelo', { exact: true })).toHaveValue('qwen3.8-27b')
})

test('limpieza sin semilla conserva conexión y modelo configurados', async ({ page, data }) => {
  await data.patchSettings({ baseUrl: 'http://conservado:1234', model: 'modelo-conservado', apiKey: 'token-conservado' })
  await page.goto('/dev/test-data')
  await page.getByRole('button', { name: 'Limpiar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Limpieza completada' })).toBeVisible()
  expect(await (await page.request.get('/api/settings')).json()).toMatchObject({
    baseUrl: 'http://conservado:1234', model: 'modelo-conservado', apiKeyConfigured: true
  })
})
