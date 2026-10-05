import { readFile } from 'node:fs/promises'
import type { Background, Message, Story } from '../../shared/types'
import { expect, test } from './fixtures'

for (const scope of ['normal', 'private'] as const) {
  test(`archiva y recupera fondos editables en ${scope} sin perder imagen ni sonidos`, async ({ page, data }) => {
    const background = await data.createBackground({ scope })
    const sound = await data.createSound(null, undefined, scope, background)
    const original = await (await page.request.get(`/api/data/backgrounds/${background.id}/content?scope=${scope}`)).body()
    await page.goto('/backgrounds')
    if (scope === 'private') {
      await page.locator('main').press('Control+Alt+p')
      await expect(page.locator('html')).toHaveClass(/private-scope/)
    }
    const card = page.locator('li').filter({ hasText: background.tags[0]! })
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Archivar', exact: true }).click()
    await expect.poll(async () => (await data.get<Background>('backgrounds', background.id, scope)).archived).toBe(true)
    await expect(card).toHaveCount(0)
    await page.reload()
    if (scope === 'private') {
      await page.locator('main').press('Control+Alt+p')
      await expect(page.locator('html')).toHaveClass(/private-scope/)
    }
    await page.getByRole('button', { name: 'Ver archivados', exact: true }).click()
    await expect(card).toBeVisible()
    await expect(card.getByText(sound.tags[0]!, { exact: true })).toBeVisible()
    const description = data.unique('descripcion-archivada')
    await card.getByLabel('Descripción del fondo').fill(description)
    await card.getByLabel('Descripción del fondo').press('Tab')
    await expect.poll(async () => (await data.get<Background>('backgrounds', background.id, scope)).description).toBe(description)
    await page.getByRole('button', { name: 'Recargar', exact: true }).click()
    await expect(card).toBeVisible()
    await expect(card.getByLabel('Descripción del fondo')).toHaveValue(description)
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }
    expect(await (await page.request.get(`/api/data/backgrounds/${background.id}/content?scope=${scope}`)).body()).toEqual(original)
    await card.getByRole('button', { name: 'Desarchivar', exact: true }).click()
    await expect.poll(async () => (await data.get<Background>('backgrounds', background.id, scope)).archived).toBe(false)
    await expect(card).toHaveCount(0)
    await page.getByRole('button', { name: 'Ver activos', exact: true }).click()
    await expect(card).toBeVisible()
  })
}

test('excluye fondos archivados de nuevas selecciones y conserva el inicial al copiar', async ({ page, data }) => {
  await data.patchSettings({ mockMode: true })
  const character = await data.createCharacter()
  const archived = await data.createBackground({ archived: true, style: 'Estilo archivado' })
  const otherArchived = await data.createBackground({ archived: true })
  const active = await data.createBackground()
  const source = await data.createStory({ characters: [character], background: archived, backgroundStyle: archived.style })
  await page.goto('/stories/new')
  await expect(page.getByLabel('Estilo de fondos').locator('option').filter({ hasText: archived.style! })).toHaveCount(0)
  await page.getByRole('button', { name: 'Seleccionar fondo inicial' }).click()
  const picker = page.getByRole('dialog', { name: 'Seleccionar fondo inicial' })
  await expect(picker.getByRole('button', { name: `Elegir fondo ${active.tags[0]}` })).toBeVisible()
  await expect(picker.getByRole('button', { name: `Elegir fondo ${archived.tags[0]}` })).toHaveCount(0)
  await expect(picker.getByRole('button', { name: `Elegir fondo ${otherArchived.tags[0]}` })).toHaveCount(0)
  await page.goto(`/stories/new?copyFrom=${source.id}`)
  const initial = page.getByRole('button', { name: 'Seleccionar fondo inicial' })
  await expect(initial).toContainText(archived.tags[0]!)
  await expect(initial).toContainText('Archivado')
  await expect(page.getByLabel('Estilo de fondos')).toHaveValue(archived.style!)
  await initial.click()
  await expect(picker.getByRole('button', { name: `Elegir fondo ${archived.tags[0]}` })).toHaveAttribute('aria-pressed', 'true')
  await expect(picker.getByText('Archivado', { exact: true })).toBeVisible()
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
  await picker.getByRole('button', { name: 'Cerrar selector de fondo' }).click()
  await page.getByLabel('Título').fill(data.unique('Copia-con-fondo-archivado'))
  await page.getByRole('button', { name: 'Empezar historia' }).click()
  await expect(page).toHaveURL(/\/stories\/(?!new(?:[?#]|$))[^/?#]+$/)
  const copiedId = new URL(page.url()).pathname.split('/').pop()!
  expect((await data.get<Story>('stories', copiedId)).initialBackgroundId).toBe(archived.id)
  await expect(page.getByText(`Fondo inicial · ${archived.tags[0]}`, { exact: true })).toBeVisible()
})

test('LLM conserva fondos archivados ya usados y sus sonidos, y excluye los demás', async ({ page, data }) => {
  const initial = await data.createBackground({ archived: true })
  const historical = await data.createBackground({ archived: true })
  const unused = await data.createBackground({ archived: true })
  const active = await data.createBackground()
  const initialSound = await data.createSound(null, undefined, 'normal', initial)
  const historicalSound = await data.createSound(null, undefined, 'normal', historical)
  const unusedSound = await data.createSound(null, undefined, 'normal', unused)
  const character = await data.createCharacter()
  const story = await data.createStory({ characters: [character], background: initial })
  await data.createMessage({ story, role: 'assistant', raw: `Fondo [${historical.tags[0]}]:\nLa escena anterior.`, segments: [
    { type: 'background', characterId: null, backgroundId: historical.id, tag: historical.tags[0]!, text: '' },
    { type: 'narration', characterId: null, tag: null, text: 'La escena anterior.' }
  ] })
  await data.patchSettings({ mockMode: false, model: 'test-model', useChromeLlm: false, responseSpeed: 'instant' })
  let systemContent = ''
  await page.route('**/api/llm/chat', async (route) => {
    systemContent = route.request().postDataJSON().messages[0].content
    await route.fulfill({ json: { content: `Fondo [${initial.tags[0]}]:\nVolvemos al inicio.`, finishReason: 'stop' } })
  })
  await page.goto(`/stories/${story.id}`)
  await expect(page.getByText(`Fondo inicial · ${initial.tags[0]}`, { exact: true })).toBeVisible()
  await expect(page.getByText('La escena anterior.', { exact: true })).toBeVisible()
  await page.getByPlaceholder('Escribe lo que haces o dices…').fill('Continuamos.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect.poll(async () => (await data.list<Message>('messages', 'normal', { storyId: story.id })).length).toBe(3)
  for (const background of [initial, historical, active]) expect(systemContent).toContain(`[${background.tags[0]}]`)
  expect(systemContent).not.toContain(`[${unused.tags[0]}]`)
  for (const sound of [initialSound, historicalSound]) expect(systemContent).toContain(`[${sound.tags[0]}]`)
  expect(systemContent).not.toContain(`[${unusedSound.tags[0]}]`)
  const last = (await data.list<Message>('messages', 'normal', { storyId: story.id })).at(-1)!
  expect(last.segments.some((segment) => segment.backgroundId === initial.id)).toBe(true)
  await page.getByRole('button', { name: 'Activar modo novela visual', exact: true }).click()
  await expect(page.getByTestId('visual-novel-background')).toBeVisible()
})

test('exporta e importa el archivado y acepta fondos antiguos como activos', async ({ page, data }) => {
  const background = await data.createBackground({ archived: true })
  await page.goto('/settings')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar JSON', exact: true }).click()
  const bundle = JSON.parse(await readFile((await (await download).path())!, 'utf8'))
  expect(bundle.version).toBe(27)
  const exported = bundle.backgrounds.find((item: Background) => item.id === background.id)
  expect(exported.archived).toBe(true)
  const importedTag = data.unique('importado-archivado')
  const legacyTag = data.unique('importado-antiguo')
  for (const [version, tag, archived] of [[26, importedTag, true], [25, legacyTag, undefined]] as const) {
    const input = { version, exportedAt: Date.now(), characters: [], stories: [], backgrounds: [
      { ...exported, tags: [tag], archived }
    ] }
    await page.locator('input[type="file"][accept="application/json"]').setInputFiles({
      name: `fondos-v${version}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input))
    })
    await expect.poll(async () => (await data.list<Background>('backgrounds')).find((item) => item.tags.includes(tag))?.archived).toBe(archived === true)
  }
})

test('demo muestra solo archivados marcados y conserva dependencias en exportación', async ({ page, data }) => {
  const marked = await data.createBackground({ archived: true, visibleInDemo: true, scope: 'private' })
  const contextual = await data.createBackground({ archived: true, scope: 'private' })
  const hidden = await data.createBackground({ archived: true, scope: 'private' })
  await data.createStory({ characters: [], background: contextual, visibleInDemo: true, scope: 'private' })
  await page.goto('/backgrounds')
  await page.locator('main').press('Control+Alt+d')
  await expect(page.locator('html')).toHaveClass(/demo-scope/)
  await expect(page.locator('li').filter({ hasText: marked.tags[0]! })).toHaveCount(0)
  await page.getByRole('button', { name: 'Ver archivados', exact: true }).click()
  await expect(page.locator('li').filter({ hasText: marked.tags[0]! })).toBeVisible()
  await expect(page.locator('li').filter({ hasText: contextual.tags[0]! })).toHaveCount(0)
  await expect(page.locator('li').filter({ hasText: hidden.tags[0]! })).toHaveCount(0)
  await page.getByRole('link', { name: 'Ajustes', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar JSON', exact: true }).click()
  const bundle = JSON.parse(await readFile((await (await download).path())!, 'utf8'))
  expect(bundle.backgrounds).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: marked.id, archived: true }),
    expect.objectContaining({ id: contextual.id, archived: true })
  ]))
  expect(bundle.backgrounds.some((item: Background) => item.id === hidden.id)).toBe(false)
})
