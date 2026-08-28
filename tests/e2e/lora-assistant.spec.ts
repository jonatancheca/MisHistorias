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
