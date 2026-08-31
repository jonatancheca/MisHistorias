import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import type { Character, CharacterImage, Message, Story, StorySaveSlot } from '../../shared/types'
import { expect, PNG_BYTES, test as base } from './fixtures'

const MODEL = 'cyberrealisticPony_v180Coreshift.safetensors'
const DIRECTIVE = 'Imagen Maria [vestida con traje de servidora]: 1girl, white background, plump, red hair, long hair, wearing black maid dress with apron, standing in mansion interior.'
const SUCCESS = { images: [`data:image/png;base64,${PNG_BYTES.toString('base64')}`] }
interface SwarmHarness {
  requests: Record<string, unknown>[]
  failSession?: boolean
  generate: (body: Record<string, unknown>, index: number) => Promise<{ status?: number; body: unknown }>
}

// El navegador llama al proxy real de Nitro; solo se simula el servidor SwarmUI remoto.
const test = base.extend<{ swarm: SwarmHarness }>({
  swarm: async ({ data }, use) => {
    const swarm: SwarmHarness = {
      requests: [],
      generate: async () => ({ body: { error: 'No model input given. Did your UI load properly?' } })
    }
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
      if (req.url === '/API/GetNewSession' && swarm.failSession) { req.socket.destroy(); return }
      let result: { status?: number; body: unknown }
      if (req.url === '/API/GetNewSession') result = { body: { session_id: 'session-never-persist', version: 'test' } }
      else if (req.url === '/API/ListT2IParams') result = { body: { models: { 'Stable-Diffusion': ['aaa-first-model', MODEL], LoRA: [] } } }
      else if (req.url === '/API/GetMyUserData') result = { body: { presets: [{ title: 'real', param_map: { prompt: '{value}' } }] } }
      else {
        swarm.requests.push(body)
        result = await swarm.generate(body, swarm.requests.length)
      }
      res.writeHead(result.status ?? 200, { 'content-type': typeof result.body === 'string' ? 'text/html' : 'application/json' })
      res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    await data.patchSettings({
      mockMode: false, model: 'qwen-test', useChromeLlm: false, privateUseChromeLlm: null,
      responseSpeed: 'instant', historyBudget: 0,
      swarmBaseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, swarmAuthToken: ''
    })
    try { await use(swarm) } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
})

test.beforeEach(async ({ request }) => {
  await expect(await request.post('/api/data/clear?scope=normal')).toBeOK()
})

test('selecciona y persiste el modelo real; diagnóstico único, copiable y transferible con respuesta solo Imagen', async ({ page, data, swarm, context }) => {
  const character = await data.createCharacter({ name: 'Nombre global', imageGenerationPreset: 'real' })
  const story = await data.createStory({ characters: [character], autoGenerateImages: true })
  await expect(await page.request.put(`/api/data/stories/${story.id}?scope=normal`, {
    data: { ...story, characterCustomizations: [{ characterId: character.id, name: 'Maria', prompt: '', tags: [] }] }
  })).toBeOK()
  const llmBodies: unknown[] = []
  await page.route('**/api/llm/chat', (route) => {
    llmBodies.push(route.request().postDataJSON())
    return route.fulfill({ json: { content: llmBodies.length === 1 ? DIRECTIVE : 'La historia continúa.', finishReason: 'stop' } })
  })
  await page.goto(`/characters/${character.id}`)
  await page.getByTestId('character-swarm-toggle').click()
  const model = page.getByLabel('Modelo SwarmUI')
  await expect(model).toHaveValue('')
  await expect(model.locator('option', { hasText: MODEL })).toHaveCount(1)
  await model.selectOption(MODEL)
  await expect.poll(async () => (await data.get<Character>('characters', character.id)).imageGenerationModel).toBe(MODEL)
  await page.getByRole('link', { name: 'Histórias', exact: true }).click()
  await page.getByRole('link', { name: story.title, exact: true }).click()
  await page.getByPlaceholder('Escribe lo que haces o dices…').fill('Continúa.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  const card = page.getByTestId('swarm-error-message')
  await expect(card).toContainText('No model input given.')
  await expect(card).toContainText('Maria')
  expect(swarm.requests).toHaveLength(1)
  expect(swarm.requests[0]).toMatchObject({ model: MODEL, prompt: `<preset:real>\n${DIRECTIVE.split(': ')[1]}` })
  const messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
  const diagnostic = messages.find((message) => message.swarmError)!
  expect(messages).toHaveLength(2)
  expect(diagnostic.swarmError?.call.response).toEqual({ status: 200, body: { error: 'No model input given. Did your UI load properly?' } })
  expect(JSON.stringify(diagnostic)).not.toContain('session-never-persist')
  expect(JSON.stringify(diagnostic)).not.toContain('session_id')
  await page.reload()
  await expect(card).toHaveCount(1)
  await expect(card).toBeVisible()
  await page.getByTestId('visual-mode-toggle').click()
  await expect(card).toBeHidden()
  await page.getByTestId('visual-mode-toggle').click()
  await expect(card).toBeVisible()
  await card.getByText('Detalles de SwarmUI', { exact: true }).click()
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await card.getByRole('button', { name: 'Copiar JSON enviado a SwarmUI' }).click()
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())).model).toBe(MODEL)
  await card.getByRole('button', { name: 'Copiar respuesta de SwarmUI' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('No model input given.')
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(card.getByRole('button', { name: 'Copiar respuesta de SwarmUI' })).toBeVisible()
    await card.screenshot({ path: test.info().outputPath(`swarm-error-${width}.png`) })
  }
  await page.getByPlaceholder('Escribe lo que haces o dices…').fill('Sigue.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByText('La historia continúa.', { exact: true })).toBeVisible()
  expect(JSON.stringify(llmBodies[1])).not.toContain('No model input given.')
  expect(JSON.stringify(llmBodies[1])).not.toContain('/API/GenerateText2Image')
  const slotResponse = await page.request.post(`/api/data/storySaves/${story.id}/create?scope=normal`, {
    data: { name: 'Diagnóstico 146', thumbnailDataUrl: 'data:image/webp;base64,UklGRg==' }
  })
  await expect(slotResponse).toBeOK()
  const slot = await slotResponse.json() as StorySaveSlot
  expect(slot.messages.filter((message) => message.swarmError)).toHaveLength(1)
  await expect(await page.request.post(`/api/data/storySaves/${slot.id}/load?scope=normal`)).toBeOK()
  expect((await data.list<Message>('messages', 'normal', { storyId: story.id })).filter((message) => message.swarmError)).toHaveLength(1)
  await page.goto('/settings')
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar JSON', exact: true }).click()
  const bundle = JSON.parse(await readFile((await (await downloadEvent).path())!, 'utf8'))
  expect(bundle.version).toBe(21)
  const exportedStory = bundle.stories.find((item: Story) => item.title === story.title)
  expect(exportedStory.messages.find((message: Message) => message.swarmError).swarmError).toEqual(diagnostic.swarmError)
  await page.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'diagnostico.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle))
  })
  await expect.poll(async () => (await data.list<Story>('stories')).length).toBe(2)
  const importedStory = (await data.list<Story>('stories')).find((item) => item.id !== story.id)!
  await expect.poll(async () => (await data.list<Message>('messages', 'normal', { storyId: importedStory.id })).filter((message) => message.swarmError).length).toBe(1)
  const imported = (await data.list<Message>('messages', 'normal', { storyId: importedStory.id })).find((message) => message.swarmError)!
  expect((await data.list<Message>('messages', 'normal', { storyId: story.id })).filter((message) => message.swarmError)).toHaveLength(1)
  expect(imported.swarmError?.characterId).not.toBe(character.id)
  expect(imported.swarmError?.call).toEqual(diagnostic.swarmError?.call)
  await expect.poll(async () => (await data.list<StorySaveSlot>('storySaves', 'normal', { storyId: imported.storyId })).length).toBe(1)
  expect((await data.list<StorySaveSlot>('storySaves', 'normal', { storyId: imported.storyId }))[0]?.messages.find((message) => message.swarmError)?.swarmError).toEqual(imported.swarmError)
})

test('refresca configuración persistida; variante fallida conserva narración, primera imagen y HTML como texto', async ({ page, data, swarm }) => {
  const character = await data.createCharacter({ name: 'Maria', imageGenerationPreset: 'real', imageGenerationModel: 'aaa-first-model' })
  const story = await data.createStory({ characters: [character], autoGenerateImages: true })
  const rawError = '<img src=x onerror="window.injected=true">' + 'fallo-de-backend-'.repeat(60)
  swarm.generate = async (_body, index) => {
    if (index === 1) {
      // Cambiar el personaje tras preparar el lote no debe modificar sus variantes.
      await page.request.put(`/api/data/characters/${character.id}?scope=normal`, { data: { ...character, imageGenerationModel: 'otro-modelo' } })
      return { body: SUCCESS }
    }
    return { status: 502, body: rawError }
  }
  await page.route('**/api/llm/chat', async (route) => {
    await page.request.put(`/api/data/characters/${character.id}?scope=normal`, {
      data: { ...character, imageGenerationModel: MODEL, imageGenerationPromptPrefix: 'persisted prefix' }
    })
    await route.fulfill({ json: { content: `${DIRECTIVE}\nMaria [vestida con traje de servidora]: Texto conservado.`, finishReason: 'stop' } })
  })
  await page.goto(`/stories/${story.id}`)
  await page.getByPlaceholder('Escribe lo que haces o dices…').fill('Adelante.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByText('Texto conservado.', { exact: true })).toBeVisible()
  const card = page.getByTestId('swarm-error-message')
  await expect(card).toHaveCount(1)
  await expect(card).toBeVisible()
  expect(swarm.requests).toHaveLength(2)
  expect(swarm.requests.every((body) => body.model === MODEL && String(body.prompt).includes('persisted prefix'))).toBe(true)
  expect(swarm.requests[1]?.variationseed).toEqual(expect.any(Number))
  const images = await data.list<CharacterImage>('images', 'normal', { characterId: character.id })
  expect(images).toHaveLength(1)
  const messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
  expect(messages.find((message) => message.swarmError)?.swarmError?.call.response).toEqual({ status: 502, body: rawError })
  expect(messages.find((message) => message.raw.includes('Texto conservado'))?.segments[0]?.imageId).toBe(images[0]?.id)
  await card.getByText('Detalles de SwarmUI', { exact: true }).click()
  await expect(card).toContainText(rawError)
  await expect(card.locator('img')).toHaveCount(0)
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

for (const action of ['cancel', 'navigate', 'scope'] as const) {
  test(`descarta fallo tardío al ${action}`, async ({ page, data, swarm }) => {
    const character = await data.createCharacter({ name: 'Maria', imageGenerationPreset: 'real', imageGenerationModel: MODEL })
    const story = await data.createStory({ characters: [character], autoGenerateImages: true })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    swarm.generate = async () => { await gate; return { status: 502, body: { error: 'Fallo tardío' } } }
    await page.route('**/api/llm/chat', (route) => route.fulfill({ json: { content: DIRECTIVE, finishReason: 'stop' } }))
    await page.goto(`/stories/${story.id}`)
    await page.getByPlaceholder('Escribe lo que haces o dices…').fill('Genera.')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect.poll(() => swarm.requests.length).toBe(1)
    try {
      if (action === 'cancel') await page.getByTestId('cancel-image-generation').click()
      else {
        await page.getByRole('link', { name: action === 'scope' ? 'Ajustes' : 'Histórias', exact: true }).click()
        if (action === 'scope') {
          const trigger = page.getByRole('button', { name: 'Activar modo privado' })
          await trigger.click(); await trigger.click(); await trigger.click()
          await expect(page).toHaveURL('/')
        }
      }
    } finally { release() }
    await expect(page.getByTestId('swarm-error-message')).toHaveCount(0)
    for (const scope of ['normal', 'private'] as const) {
      expect((await data.list<Message>('messages', scope, { storyId: story.id })).filter((message) => message.swarmError)).toHaveLength(0)
    }
  })
}

test('conexión fallida conserva JSON preparado e indica ausencia de envío y respuesta', async ({ page, data, swarm }) => {
  const character = await data.createCharacter({ name: 'Maria', imageGenerationPreset: 'real', imageGenerationModel: MODEL })
  const story = await data.createStory({ characters: [character], autoGenerateImages: true })
  swarm.failSession = true
  await page.route('**/api/llm/chat', (route) => route.fulfill({ json: { content: DIRECTIVE, finishReason: 'stop' } }))
  await page.goto(`/stories/${story.id}`)
  await page.getByPlaceholder('Escribe lo que haces o dices…').fill('Genera.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  const card = page.getByTestId('swarm-error-message')
  await expect(card).toContainText('No se pudo conectar con SwarmUI')
  await card.getByText('Detalles de SwarmUI', { exact: true }).click()
  await expect(card).toContainText('JSON preparado (no enviado)')
  await expect(card).toContainText('No se recibió respuesta HTTP.')
  const diagnostic = (await data.list<Message>('messages', 'normal', { storyId: story.id })).find((message) => message.swarmError)!.swarmError!.call
  expect(diagnostic.operation).toBe('/API/GetNewSession')
  expect(diagnostic.response).toBeNull()
  expect(diagnostic.generation?.request.model).toBe(MODEL)
  expect(diagnostic.generation?.requestSent).toBe(false)
  expect(swarm.requests).toHaveLength(0)
})

test('retira diagnóstico si se navega mientras SQLite termina de guardarlo', async ({ page, data, swarm }) => {
  const character = await data.createCharacter({ name: 'Maria', imageGenerationPreset: 'real', imageGenerationModel: MODEL })
  const story = await data.createStory({ characters: [character], autoGenerateImages: true })
  swarm.generate = async () => ({ status: 502, body: { error: 'Fallo guardado' } })
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let saved = false
  await page.route('**/api/data/messages/**', async (route) => {
    if (route.request().method() !== 'PUT' || !route.request().postDataJSON().swarmError) return route.continue()
    const response = await route.fetch()
    saved = true
    await gate
    await route.fulfill({ response })
  })
  await page.route('**/api/llm/chat', (route) => route.fulfill({ json: { content: DIRECTIVE, finishReason: 'stop' } }))
  await page.goto(`/stories/${story.id}`)
  await page.getByPlaceholder('Escribe lo que haces o dices…').fill('Genera.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  try {
    await expect.poll(() => saved).toBe(true)
    await page.getByRole('link', { name: 'Histórias', exact: true }).click()
  } finally { release() }
  await expect.poll(async () => (await data.list<Message>('messages', 'normal', { storyId: story.id })).filter((message) => message.swarmError).length).toBe(0)
})
