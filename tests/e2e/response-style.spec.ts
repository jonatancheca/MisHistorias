import { readFileSync } from 'node:fs'
import type { Message, Story } from '../../shared/types'
import { expect, test } from './fixtures'

test('configura estilo por historia y separa los cuadros narrativos', async ({ page, data, request }) => {
  await expect(await request.post('/api/data/clear?scope=normal')).toBeOK()
  await data.createCharacter({ name: 'Alicia' })
  await data.patchSettings({
    mockMode: false,
    model: 'test-model',
    useChromeLlm: false,
    privateUseChromeLlm: null,
    responseSpeed: 'instant'
  })
  let requestMessages: Array<{ role: string; content: string }> = []
  await page.route('**/api/llm/chat', async (route) => {
    requestMessages = route.request().postDataJSON().messages
    await route.fulfill({
      json: {
        content: 'Alicia [neutral]: Hola.\nLa puerta se abre.\nLa sala queda en silencio.',
        finishReason: 'stop'
      }
    })
  })

  await page.goto('/stories/new')
  await page.getByLabel('Título').fill(data.unique('Estilo'))
  await page.getByLabel('Planteamiento').fill('Una escena de prueba.')
  await page.getByRole('button', { name: /Chat/ }).click()
  await page.getByRole('button', { name: /Estilo respuesta/ }).click()
  const styleDialog = page.getByRole('dialog', { name: 'Estilo respuesta' })
  await expect(styleDialog.getByRole('radio', { name: 'Sin indicar' })).toHaveCount(2)
  await styleDialog.getByRole('radio', { name: 'Muchas (3 o más cuadros)' }).check()
  await styleDialog.getByRole('radio', { name: 'Poca (1-2 cuadros)' }).check()
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 })
    await expect(styleDialog).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
  await styleDialog.getByRole('button', { name: 'Aplicar estilo' }).click()
  await expect(page.getByRole('button', { name: /Estilo respuesta/ })).toContainText(
    'Diálogo: 3+ cuadros · Narración: 1–2 cuadros'
  )
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.setViewportSize({ width: 1280, height: 800 })

  await page.getByRole('button', { name: 'Añadir personaje' }).click()
  await page.getByRole('dialog', { name: 'Añadir personaje' })
    .getByRole('button', { name: 'Añadir Alicia al elenco' }).click()
  await page.getByRole('button', { name: 'Empezar historia' }).click()
  await expect(page).not.toHaveURL(/\/stories\/new(?:[?#]|$)/)
  await expect(page).toHaveURL(/\/stories\/[^/]+$/)
  const storyId = new URL(page.url()).pathname.split('/').pop()!
  expect(await data.get<Story>('stories', storyId)).toMatchObject({
    dialogueStyle: 'many',
    narrationStyle: 'few'
  })

  await page.getByRole('button', { name: 'Ajustes de la historia' }).click()
  const settingsDialog = page.getByRole('dialog', { name: 'Ajustes de la historia' })
  await settingsDialog.getByRole('button', { name: /Estilo respuesta/ }).click()
  const editingStyle = page.getByRole('dialog', { name: 'Estilo respuesta' })
  await expect(editingStyle.getByRole('radio', { name: 'Muchas (3 o más cuadros)' })).toBeChecked()
  await editingStyle.getByRole('radio', { name: 'Pocas (1-2 cuadros)' }).check()
  await editingStyle.getByRole('radio', { name: 'Mucha narración' }).check()
  await editingStyle.getByRole('button', { name: 'Aplicar estilo' }).click()
  await settingsDialog.getByRole('button', { name: 'Guardar', exact: true }).click()
  expect(await data.get<Story>('stories', storyId)).toMatchObject({
    dialogueStyle: 'few',
    narrationStyle: 'many'
  })

  await page.getByPlaceholder('Escribe lo que haces o dices…').fill('Abro la puerta.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect.poll(async () => (
    await data.list<Message>('messages', 'normal', { storyId })
  ).find((message) => message.role === 'assistant')?.segments.map((segment) => segment.type))
    .toEqual(['dialogue', 'narration', 'narration'])
  const system = requestMessages[0]?.content ?? ''
  expect(system).toContain('1 o 2 intervenciones de diálogo en total')
  expect(system).toContain('mucha narración repartida en varias líneas independientes')

  const original = await data.get<Story>('stories', storyId)
  await page.goto('/settings')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar JSON' }).click()
  const download = await downloadPromise
  const bundle = JSON.parse(readFileSync((await download.path())!, 'utf8')) as {
    stories: Array<{ title: string; dialogueStyle?: string; narrationStyle?: string }>
  }
  expect(bundle.stories.find((item) => item.title === original.title)).toMatchObject({
    dialogueStyle: 'few',
    narrationStyle: 'many'
  })
  await page.locator('input[accept="application/json"]').setInputFiles({
    name: 'respuesta-estilo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle))
  })
  await expect(page.getByText('Importación completada')).toBeVisible()
  const imported = (await data.list<Story>('stories')).find((item) =>
    item.id !== storyId && item.title === original.title
  )
  expect(imported).toMatchObject({ dialogueStyle: 'few', narrationStyle: 'many' })
})
