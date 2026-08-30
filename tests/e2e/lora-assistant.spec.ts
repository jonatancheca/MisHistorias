import { expect, PNG_BYTES, test } from './fixtures'

test('asistente LoRA carga imagen, genera caption editable y descarga TXT en ZIP', async ({ page }) => {
  await page.route('**/api/llm/models**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(['vision-test']) })
  })
  let received: Record<string, unknown> | null = null
  await page.route('**/api/llm/chat**', async (route) => {
    received = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: '<think>hidden</think>A person in a red coat.', finishReason: 'stop' })
    })
  })

  await page.goto('/lora-assistant')
  await expect(page.getByRole('heading', { name: 'Asistente LoRA' })).toBeVisible()
  await page.getByLabel('Prefijo común (opcional)').fill('char_token')
  await page.locator('input[type=file]').setInputFiles({
    name: 'portrait.png', mimeType: 'image/png', buffer: PNG_BYTES
  })
  await expect(page.getByText('portrait.png')).toBeVisible()
  await page.getByRole('button', { name: 'Generar descripciones' }).click()
  await expect(page.getByText('Completada', { exact: true })).toBeVisible()
  const content = received?.messages as Array<{ content: unknown }>
  expect(content[1]?.content).toEqual([
    { type: 'text', text: 'Write the caption that will be used directly in the accompanying TXT file.' },
    { type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) } }
  ])
  await page.getByLabel('Descripción editable').fill('A person in a blue coat.')
  await expect(page.getByText('char_token, A person in a blue coat.', { exact: true })).toHaveCount(0)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar ZIP' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('lora-captions.zip')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280)
  await page.setViewportSize({ width: 320, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('permite reintentar solo una imagen fallida', async ({ page }) => {
  await page.route('**/api/llm/models**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(['vision-test']) })
  })
  let requests = 0
  await page.route('**/api/llm/chat**', async (route) => {
    requests += 1
    if (requests <= 2) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ statusMessage: 'Fallo temporal' })
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: 'A person in a red coat.', finishReason: 'stop' })
    })
  })

  await page.goto('/lora-assistant')
  await page.locator('input[type=file]').setInputFiles([
    { name: 'portrait.png', mimeType: 'image/png', buffer: PNG_BYTES },
    { name: 'portrait-2.png', mimeType: 'image/png', buffer: PNG_BYTES }
  ])
  await page.getByRole('button', { name: 'Generar descripciones' }).click()
  await expect(page.getByText('Fallida', { exact: true })).toHaveCount(2)
  await page.getByRole('button', { name: 'Reintentar portrait.png' }).click()
  await expect(page.getByText('Completada', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Fallida', { exact: true })).toHaveCount(1)
  expect(requests).toBe(3)
})
