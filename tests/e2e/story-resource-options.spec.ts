import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import type { LlmDebugTrace, Message, Story, StorySaveSlot } from '../../shared/types'
import { test, expect } from './fixtures'

interface LlmRequest {
  operation?: string
  messages: Array<{ role: string; content: string }>
}

test.beforeEach(async ({ page, data }) => {
  await data.patchSettings({
    mockMode: false, model: 'test-model', useChromeLlm: false, privateUseChromeLlm: null,
    privateLlmSettingsEnabled: false, historyBudget: 100000, contextTokenBudget: 0,
    contextUnit: 'characters', maxTokens: 100, responseSpeed: 'instant', narrativePrompt: null,
    compactionPrompt: null
  })
  await page.route('**/api/llm/model-status?*', route => route.fulfill({ json: { loaded: true } }))
  await page.route('**/api/llm/context', route => {
    const request = route.request().postDataJSON() as LlmRequest
    return route.fulfill({ json: {
      tokens: Math.ceil(request.messages.reduce((total, message) => total + message.content.length, 0) / 4),
      capacity: 30000, model: 'test-model'
    } })
  })
})

async function openSettings(page: Page) {
  await page.getByTestId('story-tools-toggle').click()
  await page.getByRole('button', { name: 'Ajustes de la historia', exact: true }).click()
  return page.getByRole('dialog', { name: 'Ajustes de la historia', exact: true })
}

async function breakdown(card: Locator) {
  await card.getByText('Desglose del contexto', { exact: true }).click()
  const counts = await card.locator('[data-context-section]').evaluateAll(rows => Object.fromEntries(rows.map(row => [
    row.getAttribute('data-context-section')!,
    Number(row.querySelector('dd')!.textContent!.replace(/\D/g, ''))
  ])))
  const total = Number((await card.getByTestId('context-character-total').innerText()).replace(/\D/g, ''))
  expect(Object.values(counts).reduce((sum, count) => sum + count, 0)).toBe(total)
  return { counts, total }
}

test('crea, edita y copia opciones sin perder fondo inicial ni estilo; adaptable a móvil', async ({ page, data }) => {
  const character = await data.createCharacter()
  const background = await data.createBackground({ style: data.unique('Acuarela') })
  await page.goto('/stories/new')
  await expect(page.getByRole('checkbox', { name: /^Usar fondos/ })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: /^Usar sonidos/ })).toBeChecked()
  await page.getByLabel('Título', { exact: true }).fill('Recursos opcionales')
  await page.getByLabel('Planteamiento', { exact: true }).fill('Una noche tranquila en el bosque.')
  await page.getByRole('button', { name: 'Añadir personaje', exact: true }).click()
  await page.getByRole('dialog', { name: 'Añadir personaje' })
    .getByRole('button', { name: `Añadir ${character.name} al elenco` }).click()
  await page.getByLabel('Estilo de fondos', { exact: true }).selectOption(background.style!)
  await page.getByRole('button', { name: 'Seleccionar fondo inicial', exact: true }).click()
  await page.getByRole('dialog', { name: 'Seleccionar fondo inicial', exact: true })
    .getByRole('button', { name: `Elegir fondo ${background.tags[0]}` }).click()
  await page.getByRole('checkbox', { name: /^Usar fondos/ }).uncheck()
  await page.getByRole('checkbox', { name: /^Usar sonidos/ }).uncheck()
  await expect(page.getByLabel('Estilo de fondos', { exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Seleccionar fondo inicial' })).toBeDisabled()
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
  await page.getByRole('button', { name: 'Empezar historia' }).click()
  await expect(page).toHaveURL(/\/stories\/(?!new)[^/]+$/)
  const id = new URL(page.url()).pathname.split('/').pop()!
  expect(await data.get<Story>('stories', id)).toMatchObject({
    useBackgrounds: false, useSounds: false, initialBackgroundId: background.id, backgroundStyle: background.style
  })
  await page.reload()
  let settings = await openSettings(page)
  await expect(settings.getByRole('checkbox', { name: /^Usar fondos/ })).not.toBeChecked()
  await expect(settings.getByRole('checkbox', { name: /^Usar sonidos/ })).not.toBeChecked()
  await settings.getByRole('checkbox', { name: /^Usar fondos/ }).check()
  await expect(settings.getByLabel('Estilo de fondos')).toHaveValue(background.style!)
  await expect(settings.getByRole('button', { name: 'Seleccionar fondo inicial' })).toContainText(background.tags[0]!)
  await settings.getByRole('button', { name: 'Guardar', exact: true }).click()
  expect(await data.get<Story>('stories', id)).toMatchObject({ useBackgrounds: true, useSounds: false })
  await page.goto(`/stories/new?copyFrom=${id}`)
  await expect(page.getByRole('checkbox', { name: /^Usar fondos/ })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: /^Usar sonidos/ })).not.toBeChecked()
  await page.getByRole('button', { name: 'Empezar historia' }).click()
  await expect(page).toHaveURL(/\/stories\/(?!new)[^/]+$/)
  const copiedId = new URL(page.url()).pathname.split('/').pop()!
  expect(copiedId).not.toBe(id)
  expect(await data.get<Story>('stories', copiedId)).toMatchObject({ useBackgrounds: true, useSounds: false })
  settings = await openSettings(page)
  await settings.getByRole('checkbox', { name: /^Usar fondos/ }).uncheck()
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await settings.getByRole('checkbox', { name: /^Usar fondos/ }).locator('..').locator('..')
      .evaluate(element => element.scrollIntoView({ block: 'center' }))
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    expect(await settings.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: `.data/issue-271-settings-${width}.png`, animations: 'disabled' })
  }
  await page.setViewportSize({ width: 1280, height: 1000 })
  await settings.getByRole('checkbox', { name: /^Usar fondos/ }).locator('..').locator('..')
    .evaluate(element => element.scrollIntoView({ block: 'center' }))
  await page.screenshot({ path: '.data/issue-271-settings-desktop.png', animations: 'disabled' })
})

test('transferencia conserva opciones actuales y partidas; archivos antiguos activan ambos recursos', async ({ page, data }) => {
  const character = await data.createCharacter()
  const story = await data.createStory({ characters: [character], useBackgrounds: false, useSounds: false })
  await expect(await page.request.post(`/api/data/storySaves/${story.id}/create?scope=normal`, {
    data: { name: 'Sin recursos', thumbnailDataUrl: 'data:image/webp;base64,UklGRg==' }
  })).toBeOK()
  await page.goto('/settings')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar JSON', exact: true }).click()
  const exported = JSON.parse(readFileSync((await (await downloadPromise).path())!, 'utf8')) as Awaited<ReturnType<typeof import('../../app/lib/transfer').exportBundle>>
  const item = exported.stories.find(entry => entry.title === story.title)!
  expect(item).toMatchObject({ useBackgrounds: false, useSounds: false })
  expect(item.saves?.[0]?.story).toMatchObject({ useBackgrounds: false, useSounds: false })
  exported.stories = [item]
  exported.characters = exported.characters.filter(entry => item.characterIds.includes(entry.id))
  exported.backgrounds = []
  exported.sounds = []
  exported.swarmPrompts = []
  const input = page.locator('input[accept="application/json"]')
  await input.setInputFiles({ name: 'resources.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) })
  await expect(page.getByText('Importación completada', { exact: true })).toBeVisible()
  const imported = (await data.list<Story>('stories')).find(entry => entry.id !== story.id && entry.title === story.title)!
  expect(imported).toMatchObject({ useBackgrounds: false, useSounds: false })
  const saves = await data.list<StorySaveSlot>('storySaves', 'normal', { storyId: imported.id })
  expect(saves[0]?.story).toMatchObject({ useBackgrounds: false, useSounds: false })
  item.title = data.unique('Historia antigua')
  delete item.useBackgrounds
  delete item.useSounds
  for (const save of item.saves ?? []) {
    delete save.story.useBackgrounds
    delete save.story.useSounds
  }
  await input.setInputFiles({ name: 'legacy-resources.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) })
  await expect.poll(async () => (await data.list<Story>('stories')).find(entry => entry.title === item.title)?.useSounds).toBe(true)
  const legacy = (await data.list<Story>('stories')).find(entry => entry.title === item.title)!
  expect(legacy.useBackgrounds).toBe(true)
  const legacySaves = await data.list<StorySaveSlot>('storySaves', 'normal', { storyId: legacy.id })
  expect(legacySaves[0]?.story).toMatchObject({ useBackgrounds: true, useSounds: true })
})

test('respuesta formada solo por directivas desactivadas no se ejecuta y conserva original en trazas', async ({ page, data }) => {
  const story = await data.createStory({ characters: [], useBackgrounds: false, useSounds: false })
  const content = 'Fondo [bosque]:\nSonido [lluvia]:'
  let calls = 0
  await page.route('**/api/llm/chat', route => {
    calls++
    return route.fulfill({ json: { content, finishReason: 'stop' } })
  })
  await page.goto(`/stories/${story.id}`)
  await page.getByPlaceholder(/Escribe lo que haces/).fill('Continúo caminando.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByTestId('story-generation-feedback')).toContainText('El modelo no devolvió contenido visible.')
  expect(calls).toBe(2)
  expect((await data.list<Message>('messages', 'normal', { storyId: story.id })).every(message => message.role !== 'assistant')).toBe(true)
  const traces = await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })
  expect(traces).toHaveLength(2)
  expect(traces.every(trace => 'content' in trace.response && trace.response.content === content)).toBe(true)
})

for (const useBackgrounds of [false, true]) {
  for (const useSounds of [false, true]) {
    test(`contexto, compactación y respuestas respetan fondos=${useBackgrounds}, sonidos=${useSounds}`, async ({ page, data }) => {
      const character = await data.createCharacter()
      const background = await data.createBackground({ tags: [data.unique('FONDO_UNICO')], style: data.unique('Estilo') })
      const characterSound = await data.createSound(character, [data.unique('EFECTO_UNICO')])
      const backgroundSound = await data.createSound(null, [data.unique('AMBIENTE_UNICO')], 'normal', background)
      const story = await data.createStory({ characters: [character], background, backgroundStyle: background.style, useBackgrounds, useSounds })
      const directives = `Fondo [${background.tags[0]}]:\nSonido [${characterSound.tags[0]}]:\nSonido [${backgroundSound.tags[0]}]:`
      const old = await data.createMessage({ story, role: 'assistant', raw: `${directives}\n${'La noche sigue tranquila. '.repeat(400)}` })
      const measurements: LlmRequest[] = []
      const requests: LlmRequest[] = []
      await page.route('**/api/llm/context', route => {
        const request = route.request().postDataJSON() as LlmRequest
        measurements.push(request)
        return route.fulfill({ json: {
          tokens: Math.ceil(request.messages.reduce((sum, message) => sum + message.content.length, 0) / 4),
          capacity: 30000, model: 'test-model'
        } })
      })
      const response = `${directives}\n${character.name} [neutral]: Seguimos adelante.`
      await page.route('**/api/llm/chat', route => {
        const request = route.request().postDataJSON() as LlmRequest
        requests.push(request)
        return route.fulfill({ json: { content: request.operation === 'story.compaction' ? 'La noche sigue tranquila.' : response, finishReason: 'stop' } })
      })
      await page.goto(`/stories/${story.id}`)
      await page.locator('[data-testid^="story-context-"]').first().click()
      await page.getByRole('button', { name: 'Compactar historia', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Compactar historia', exact: true })
      await expect(dialog.getByRole('button', { name: 'Compactar', exact: true })).toBeEnabled()
      const before = await breakdown(dialog.getByTestId('manual-compaction-before'))
      expect(before.total).toBe(measurements.at(-1)!.messages.reduce((sum, message) => sum + message.content.length, 0))
      expect(Boolean(before.counts.backgrounds)).toBe(useBackgrounds)
      expect(Boolean(before.counts.sounds)).toBe(useSounds)
      const sent = JSON.stringify(measurements.at(-1)!.messages)
      expect(sent.includes(background.tags[0]!)).toBe(useBackgrounds)
      expect(sent.includes(characterSound.tags[0]!)).toBe(useSounds)
      expect(sent.includes(backgroundSound.tags[0]!)).toBe(useBackgrounds && useSounds)
      await dialog.getByRole('button', { name: 'Compactar', exact: true }).click()
      await expect(dialog.getByTestId('manual-compaction-after')).toBeVisible()
      const after = await breakdown(dialog.getByTestId('manual-compaction-after'))
      expect(after.total).toBe(measurements.at(-1)!.messages.reduce((sum, message) => sum + message.content.length, 0))
      expect(after.counts.backgrounds).toBe(before.counts.backgrounds)
      expect(after.counts.sounds).toBe(before.counts.sounds)
      expect(JSON.stringify(requests[0]!.messages).includes(background.tags[0]!)).toBe(useBackgrounds)
      expect(JSON.stringify(requests[0]!.messages).includes(characterSound.tags[0]!)).toBe(useSounds)
      expect(JSON.stringify(requests[0]!.messages).includes(backgroundSound.tags[0]!)).toBe(useBackgrounds && useSounds)
      expect((await data.get<Message>('messages', old.id)).raw).toBe(old.raw)
      await dialog.getByRole('button', { name: 'Cerrar diálogo', exact: true }).click()
      await page.getByPlaceholder(/Escribe lo que haces/).fill('Continúo caminando.')
      await page.getByRole('button', { name: 'Enviar', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled()
      const messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
      const generated = messages.find(message => message.originalRaw === response)!
      expect(generated).toBeTruthy()
      expect(generated.segments.some(segment => segment.type === 'background')).toBe(useBackgrounds)
      expect(generated.segments.some(segment => segment.soundId === characterSound.id)).toBe(useSounds)
      expect(generated.segments.some(segment => segment.soundId === backgroundSound.id)).toBe(useBackgrounds && useSounds)
      expect(generated.originalRaw).toBe(response)
      const payload = JSON.stringify(requests.at(-1)!.messages)
      expect(payload.includes('Fondo [etiqueta]:')).toBe(useBackgrounds)
      expect(payload.includes('Sonido [etiqueta]:')).toBe(useSounds)
      expect(payload.includes('Sonido [puerta]:')).toBe(useSounds)
    })
  }
}
