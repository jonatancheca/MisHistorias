import type { LlmDebugTrace, StorySaveSlot } from '../../shared/types'
import { expect, test } from './fixtures'

let thumbnailDataUrl = ''

test.beforeEach(async ({ page, data }) => {
  await data.patchSettings({ mockMode: true, useChromeLlm: false, privateUseChromeLlm: false, privateLlmSettingsEnabled: false, defaultSoundVersion: 1,
    privateDefaultSoundVersion: 1, responseSpeed: 'instant', visualNovelManualAdvance: false })
  await page.goto('/')
  thumbnailDataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 2
    return canvas.toDataURL('image/webp')
  })
})

for (const scope of ['normal', 'private'] as const) {
  test(`archivos ajenos y consulta de modelo pendiente no bloquean; scope=${scope}`, async ({ page, data }) => {
    await data.patchSettings({ mockMode: false, model: 'modelo-prueba' })
    const character = await data.createCharacter({ scope })
    await data.createImage(character, ['neutral'], scope)
    await data.createBackground({ scope })
    await data.createSound(character, [data.unique('sonido-ajeno')], scope)
    const story = await data.createStory({ characters: [], scope })
    const contentRequests: string[] = []
    let imageCatalogRequests = 0
    const requested = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    await page.route('**/api/data/images?*', async route => {
      imageCatalogRequests += 1
      await route.continue()
    })
    await page.route('**/api/data/**/content?*', async route => {
      contentRequests.push(route.request().url())
      await release.promise
      await route.continue()
    })
    await page.route('**/api/llm/model-status?*', async route => {
      requested.resolve(undefined)
      await release.promise
      await route.fulfill({ json: { loaded: true } })
    })
    try {
      if (scope === 'private') {
        await page.goto('/settings')
        const trigger = page.getByRole('button', { name: 'Activar modo privado' })
        for (let index = 0; index < 3; index++) await trigger.click()
        await expect(page.locator('html')).toHaveClass(/private-scope/)
        await page.getByRole('link', { name: 'Historias', exact: true }).click()
        await page.getByRole('link', { name: story.title, exact: true }).click()
      } else {
        await page.goto(`/stories/${story.id}`, { waitUntil: 'domcontentloaded' })
      }
      await requested.promise
      await expect(page.getByRole('heading', { name: story.title })).toBeVisible()
      await page.getByRole('textbox', { name: 'Tu intervención' }).fill('Borrador con modelo pendiente.')
      await expect(page.getByRole('textbox', { name: 'Tu intervención' })).toHaveValue('Borrador con modelo pendiente.')
      expect(contentRequests).toEqual([])
      expect(imageCatalogRequests).toBe(1)
    } finally {
      release.resolve(undefined)
    }
  })
}

test('imágenes y fondo usados pueden seguir descargando con historia ya abierta', async ({ page, data }) => {
  const character = await data.createCharacter()
  const image = await data.createImage(character)
  const background = await data.createBackground()
  const story = await data.createStory({ characters: [character], background, visualMode: true })
  await data.createMessage({ story, role: 'assistant', raw: 'Hola.', segments: [
    { type: 'dialogue', characterId: character.id, characterName: character.name,
      imageId: image.id, tag: 'neutral', text: 'Hola.' }
  ] })
  const requested = new Set<string>()
  const release = Promise.withResolvers<undefined>()
  await page.route('**/api/data/**/content?*', async route => {
    requested.add(new URL(route.request().url()).pathname)
    await release.promise
    await route.continue()
  })
  try {
    await page.goto(`/stories/${story.id}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: story.title })).toBeVisible()
    await expect(page.getByTestId('visual-novel-frame')).toContainText('Hola.')
    await page.getByRole('textbox', { name: 'Tu intervención' }).fill('Puedo escribir durante la descarga.')
    await expect.poll(() => requested.has(`/api/data/images/${image.id}/content`)).toBe(true)
    await expect.poll(() => requested.has(`/api/data/backgrounds/${background.id}/content`)).toBe(true)
    release.resolve(undefined)
    const renderedImage = page.locator(`img[src*="/images/${image.id}/content"]`).first()
    await expect.poll(() => renderedImage.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  } finally {
    release.resolve(undefined)
  }
})

test('Debug y partidas llegan después; guarda durante la consulta sin perder la partida nueva', async ({ page, data }) => {
  const story = await data.createStory({ characters: [] })
  const message = await data.createMessage({ story, role: 'assistant', raw: 'Escena.',
    segments: [{ type: 'narration', text: 'Escena.' }] })
  const trace: LlmDebugTrace = { id: data.unique('trace'), storyId: story.id, responseMessageId: message.id,
    status: 'success', createdAt: message.createdAt,
    request: { model: 'prueba', messages: [], temperature: 0.7, max_tokens: 100, stream: false },
    response: { content: message.raw, finishReason: 'stop' } }
  await expect(await page.request.put(`/api/data/llmDebugTraces/${trace.id}?scope=normal`, { data: trace })).toBeOK()
  const original = await page.request.post(`/api/data/storySaves/${story.id}/create?scope=normal`, {
    data: { name: 'Partida anterior', thumbnailDataUrl }
  })
  await expect(original).toBeOK()
  const release = Promise.withResolvers<undefined>()
  let requested = 0
  for (const resource of ['llmDebugTraces', 'storySaves']) {
    await page.route(`**/api/data/${resource}?*`, async route => {
      const response = await route.fetch()
      requested += 1
      await release.promise
      await route.fulfill({ response })
    })
  }
  try {
    await page.goto(`/stories/${story.id}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: story.title })).toBeVisible()
    await expect.poll(() => requested).toBe(2)
    await expect(page.getByRole('button', { name: 'Ver datos de debug de la llamada LLM' })).toHaveCount(0)
    await page.getByTestId('story-tools-toggle').click()
    await page.getByRole('button', { name: 'Partidas', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Partidas', exact: true })
    await expect(dialog.getByRole('status')).toHaveText('Cargando partidas…')
    await expect(dialog).not.toContainText('Todavía no hay partidas guardadas.')
    await dialog.getByLabel('Nombre de la partida').fill('Guardada durante la consulta')
    await dialog.getByRole('button', { name: 'Guardar partida' }).click()
    await expect.poll(async () => (await data.list<StorySaveSlot>('storySaves', 'normal', { storyId: story.id })).length).toBe(2)
    release.resolve(undefined)
    await expect(dialog).toContainText('Partida anterior')
    await expect(dialog).toContainText('Guardada durante la consulta')
    await dialog.getByRole('button', { name: 'Cerrar partidas' }).click()
    await expect(page.getByRole('button', { name: 'Ver datos de debug de la llamada LLM' })).toHaveCount(1)
  } finally {
    release.resolve(undefined)
  }
})

test('respuestas auxiliares tardías de otra historia no contaminan la actual', async ({ page, data }) => {
  const first = await data.createStory({ characters: [] })
  const second = await data.createStory({ characters: [] })
  const release = Promise.withResolvers<undefined>()
  let requested = 0
  for (const resource of ['llmDebugTraces', 'storySaves']) {
    await page.route(`**/api/data/${resource}?*`, async route => {
      if (new URL(route.request().url()).searchParams.get('storyId') !== first.id) return route.continue()
      requested += 1
      await release.promise
      await route.fulfill({ json: resource === 'storySaves'
        ? [{ id: 'old-save', storyId: first.id, name: 'Partida de otra historia', createdAt: 1, thumbnailDataUrl }]
        : [] })
    })
  }
  try {
    await page.goto(`/stories/${first.id}`, { waitUntil: 'domcontentloaded' })
    await expect.poll(() => requested).toBe(2)
    await page.getByRole('link', { name: 'Historias', exact: true }).click()
    await page.getByRole('link', { name: second.title, exact: true }).click()
    await expect(page.getByRole('heading', { name: second.title })).toBeVisible()
    release.resolve(undefined)
    await page.getByTestId('story-tools-toggle').click()
    await page.getByRole('button', { name: 'Partidas', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Partidas', exact: true })
    await expect(dialog).toContainText('Todavía no hay partidas guardadas.')
    await expect(dialog).not.toContainText('Partida de otra historia')
  } finally {
    release.resolve(undefined)
  }
})

test('fallo de partidas no bloquea escritura ni se presenta como lista vacía', async ({ page, data }) => {
  const story = await data.createStory({ characters: [] })
  await page.route('**/api/data/storySaves?*', route => route.fulfill({ status: 502, json: { message: 'Consulta interrumpida' } }))
  await page.goto(`/stories/${story.id}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('textbox', { name: 'Tu intervención' }).fill('Historia sigue utilizable.')
  await page.getByTestId('story-tools-toggle').click()
  await page.getByRole('button', { name: 'Partidas', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Partidas', exact: true })
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog).not.toContainText('Todavía no hay partidas guardadas.')
  await dialog.getByRole('button', { name: 'Cerrar partidas' }).click()
  await expect(page.getByRole('textbox', { name: 'Tu intervención' })).toHaveValue('Historia sigue utilizable.')
})

test('fallo al guardar imagen conserva la predeterminada anterior', async ({ page, data }) => {
  const character = await data.createCharacter()
  const first = await data.createImage(character, ['primera'])
  await data.createImage(character, ['segunda'])
  await page.goto(`/characters/${character.id}`)
  const cards = page.getByTestId('character-image-card')
  await expect(cards.nth(1).getByRole('radio')).toBeChecked()
  await page.route(`**/api/data/images/${first.id}?*`, route => route.fulfill({
    status: 409, json: { message: 'Guardado de imagen interrumpido' }
  }))
  await cards.nth(0).getByRole('radio').check()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(cards.nth(0).getByRole('radio')).not.toBeChecked()
  await expect(cards.nth(1).getByRole('radio')).toBeChecked()
  expect((await data.get<{ isDefault: boolean }>('images', first.id)).isDefault).toBe(false)
})
