import type { ErrorTraceListResponse } from '../../shared/types'
import { expect, test } from './fixtures'

test('registra y consulta trazas persistentes desde Ajustes', async ({ page }, testInfo) => {
  await expect(await page.request.delete('/api/error-traces')).toBeOK()
  const originalSettingsResponse = await page.request.get('/api/settings')
  const originalSettingsText = await originalSettingsResponse.text()
  const originalSettings = originalSettingsText
    ? JSON.parse(originalSettingsText) as { baseUrl?: string }
    : {}
  const upstreamSecret = 'upstream-secret-in-header'
  await expect(await page.request.patch('/api/settings', {
    data: { baseUrl: 'http://127.0.0.1:1', apiKey: upstreamSecret }
  })).toBeOK()
  const failedLlm = await page.request.post('/api/llm/chat', {
    data: {
      model: 'modelo-inaccesible',
      messages: [{ role: 'user', content: 'llamada que debe fallar' }],
      operation: 'test.llm.automatic',
      scope: 'normal'
    }
  })
  expect(failedLlm.status()).toBe(502)
  await expect(await page.request.patch('/api/settings', {
    data: { baseUrl: originalSettings.baseUrl ?? 'http://localhost:1234', apiKey: '' }
  })).toBeOK()

  const automaticResponse = await page.request.get('/api/error-traces?source=llm&scope=normal')
  const automatic = await automaticResponse.json() as ErrorTraceListResponse
  const automaticTrace = automatic.items.find(item => item.operation === 'test.llm.automatic')
  expect(automaticTrace).toBeDefined()
  expect(JSON.stringify(automaticTrace?.request)).not.toContain(upstreamSecret)
  expect(automaticTrace?.requestSent).toBeNull()
  expect(automaticTrace?.response).toBeNull()

  const secret = 'secret-visible-en-traza'
  const created = await page.request.post('/api/error-traces/report', {
    data: {
      source: 'llm',
      operation: 'test.llm.failure',
      message: 'Fallo LLM de prueba',
      scope: 'private',
      status: 502,
      requestSent: true,
      request: {
        authorization: `Bearer ${secret}`,
        image: 'data:image/png;base64,AAAA'
      },
      response: { apiKey: secret, detail: 'Fallo recibido' }
    }
  })
  await expect(created).toBeOK()

  const storedResponse = await page.request.get('/api/error-traces?source=llm&scope=private')
  await expect(storedResponse).toBeOK()
  const stored = await storedResponse.json() as ErrorTraceListResponse
  expect(stored.total).toBe(1)
  expect(JSON.stringify(stored.items[0]?.request)).not.toContain(secret)
  expect(JSON.stringify(stored.items[0]?.response)).not.toContain(secret)
  expect(JSON.stringify(stored.items[0]?.response)).toContain('Fallo recibido')
  expect(JSON.stringify(stored.items[0]?.request)).not.toContain('data:image/png;base64')
  expect(stored.items[0]?.request).toMatchObject({
    image: { omitted: 'data-url', mimeType: 'image/png', sizeBytes: 3 }
  })

  await page.goto('/settings#datos')
  const card = page.getByTestId('error-traces-settings-card')
  await expect(card).toContainText('las credenciales reconocibles se ocultan')
  await card.getByRole('link', { name: 'Abrir trazas' }).click()
  await expect(page).toHaveURL('/error-traces')
  await expect(page.getByRole('heading', { name: 'Trazas de error' })).toBeVisible()
  await expect(page.getByTestId('error-trace-list')).toContainText('Fallo LLM de prueba')

  await page.getByTestId('error-trace-list').getByRole('button')
    .filter({ hasText: 'Fallo LLM de prueba' }).click()
  const detail = page.getByRole('dialog', { name: 'Detalle de traza' })
  await expect(detail).not.toContainText(secret)
  await expect(detail).toContainText('Fallo recibido')
  await expect(detail).toContainText('data-url')
  await expect(detail).not.toContainText('data:image/png;base64')
  await page.screenshot({ path: testInfo.outputPath('error-traces-desktop.png'), fullPage: true })
  await detail.getByRole('button', { name: 'Cerrar detalle de traza' }).click()

  for (const viewport of [
    { width: 320, height: 800 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport)
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width)
    await page.screenshot({
      path: testInfo.outputPath(`error-traces-${viewport.width}.png`),
      fullPage: true
    })
  }

  const oversized = 'x'.repeat(300 * 1024)
  await expect(await page.request.post('/api/error-traces/report', {
    data: {
      source: 'client',
      operation: 'test.oversized',
      message: 'Traza grande',
      request: { oversized },
      response: null
    }
  })).toBeOK()
  const oversizedResponse = await page.request.get('/api/error-traces?source=client')
  const oversizedStored = await oversizedResponse.json() as ErrorTraceListResponse
  expect(oversizedStored.items[0]?.requestTruncated).toBe(true)
  expect(JSON.stringify(oversizedStored.items[0]?.request).length).toBeLessThan(256 * 1024)

  await page.getByRole('button', { name: 'Borrar todas' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Borrar todas las trazas' })
  await expect(confirm).toContainText('backups SQLite anteriores')
  await confirm.getByRole('button', { name: 'Borrar todas' }).click()
  await expect(page.getByText('No hay trazas para estos filtros.')).toBeVisible()
})
