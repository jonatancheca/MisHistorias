import type { AppSettings, Character, CharacterImage, SwarmPrompt } from '../../shared/types'
import { readFile } from 'node:fs/promises'
import { expect, PNG_BYTES, test } from './fixtures'

const CATALOG = {
  version: 'test-1.0',
  models: ['model-a', 'model-b'],
  loras: ['detail-lora'],
  presets: ['Retrato', 'Cuerpo entero']
}

test.beforeEach(async ({ request }) => {
  // Este servidor usa una SQLite temporal exclusiva de Playwright.
  await expect(await request.post('/api/data/clear?scope=normal')).toBeOK()
})

test('configura SwarmUI, muestra catálogo y genera una vista temporal', async ({ page, data }) => {
  let generationBody: Record<string, unknown> | null = null
  await page.route('**/api/swarm/catalog', (route) => route.fulfill({ json: CATALOG }))
  await page.route('**/api/swarm/generate', async (route) => {
    generationBody = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ contentType: 'image/png', body: PNG_BYTES })
  })
  await data.patchSettings({ swarmBaseUrl: 'http://localhost:7801', swarmAuthToken: '' })

  await page.goto('/settings')
  const swarm = page.getByTestId('swarm-settings')
  await swarm.getByLabel('Token de SwarmUI (opcional)').fill('token-prueba')
  await expect(page.getByText('Guardado', { exact: true })).toBeVisible()
  const publicSettings = await page.request.get('/api/settings')
  const storedSettings = await publicSettings.json() as AppSettings
  expect(storedSettings.swarmAuthToken).toBe('')
  expect(storedSettings.swarmAuthConfigured).toBe(true)
  const secret = await page.request.post('/api/settings/swarm-token')
  expect(await secret.json()).toEqual({ swarmAuthToken: 'token-prueba' })

  await swarm.getByRole('button', { name: 'Probar conexión', exact: true }).click()
  await expect(swarm.getByText(/SwarmUI test-1\.0: 2 modelos, 1 LoRAs y 2 presets/)).toBeVisible()
  await expect(swarm.getByText('Modelos (2)')).toBeVisible()
  await expect(swarm.getByText('LoRAs (1)')).toBeVisible()
  await expect(swarm.getByText('Presets (2)')).toBeVisible()
  await expect(swarm.getByLabel('Modelo de prueba')).toBeVisible()
  await swarm.getByLabel('LoRA de prueba').selectOption('detail-lora')

  const prompt = 'Edited temporary prompt with standing pose, coat and joyful expression.'
  await swarm.getByLabel('Prompt de prueba').fill(prompt)
  await swarm.getByRole('button', { name: 'Generar imagen de prueba' }).click()
  await expect(swarm.getByTestId('swarm-test-preview')).toBeVisible()
  expect(generationBody).toEqual({
    prompt,
    preset: 'Retrato',
    model: 'model-a',
    lora: 'detail-lora'
  })
  await swarm.getByRole('button', { name: 'Ampliar Resultado temporal de SwarmUI' }).click()
  const previewDialog = page.getByRole('dialog', { name: 'Resultado temporal de SwarmUI' })
  await expect(previewDialog).toBeVisible()
  await previewDialog.getByRole('button', { name: 'Cerrar imagen' }).click()
  await expect(previewDialog).toHaveCount(0)
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true)
  }
})

test('oculta funciones sin URL y permite configurar sin valor por defecto', async ({ page, data }) => {
  await data.patchSettings({ swarmBaseUrl: '' })
  const character = await data.createCharacter()
  await page.goto('/settings')
  await expect(page.getByLabel('URL de SwarmUI')).toHaveValue('')
  await expect(page.getByLabel('Token de SwarmUI (opcional)')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Prompts SwarmUI', exact: true })).toHaveCount(0)
  await page.goto(`/characters/${character.id}`)
  await expect(page.getByTestId('character-swarm-toggle')).toHaveCount(0)
  const response = await page.request.get('/api/swarm/catalog')
  expect(response.ok()).toBe(false)
  expect(await response.text()).toContain('Falta la URL de SwarmUI')
})

test('mantiene catálogo y crea conjunto con semillas compartidas, etiquetas y transferencia JSON', async ({ page, data }) => {
  await data.patchSettings({ swarmBaseUrl: 'http://localhost:7801' })
  const character = await data.createCharacter({ imageGenerationSeed: '42', imageGenerationPromptPrefix: 'quality' })
  const bodies: Array<Record<string, unknown>> = []
  await page.route('**/api/swarm/catalog', (route) => route.fulfill({ json: CATALOG }))
  await page.route('**/api/swarm/generate', async (route) => {
    bodies.push(route.request().postDataJSON())
    await route.fulfill({ contentType: 'image/png', body: PNG_BYTES })
  })
  await page.goto('/swarm-prompts')
  await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeDisabled()
  for (const [name, prompt, tag] of [['Sentada', ', sitting', 'sentada'], ['De pie', 'standing', 'de pie']]) {
    await page.getByRole('button', { name: 'Nuevo prompt', exact: true }).click()
    await page.getByLabel('Nombre', { exact: true }).fill(name!)
    await page.getByLabel('Prompt', { exact: true }).fill(prompt!)
    await page.getByLabel('Etiquetas de imagen', { exact: true }).fill(tag!)
    await page.getByLabel('Etiquetas de imagen', { exact: true }).press('Enter')
    await page.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(page.getByText('Prompt guardado.', { exact: true })).toBeVisible()
  }
  const prompts = await data.list<SwarmPrompt>('swarmPrompts')
  expect(prompts.map((item) => item.name)).toEqual(['Sentada', 'De pie'])
  const invalid = await page.request.put('/api/data/swarmPrompts/invalid?scope=normal', {
    data: { ...prompts[0], id: 'invalid', name: ' ' }
  })
  expect(invalid.status()).toBe(400)
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 850 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.goto(`/characters/${character.id}`)
  await page.getByTestId('character-swarm-toggle').click()
  await page.getByLabel('Prompt de imagen (inglés y editable)').fill('portrait, ')
  await page.getByLabel('Etiquetas para el prompt').fill('feliz')
  await page.getByLabel('Etiquetas para el prompt').press('Enter')
  await page.getByLabel('Número de imágenes').fill('2')
  await page.getByRole('button', { name: 'Crear conjunto de imágenes', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('2 imágenes × 2 prompts = 4 imágenes')
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
  expect(bodies).toHaveLength(0)
  await page.getByRole('button', { name: 'Crear conjunto de imágenes', exact: true }).click()
  await dialog.getByRole('button', { name: 'Crear conjunto', exact: true }).click()
  await expect(page.getByText('4 imágenes generadas y guardadas en la galería.')).toBeVisible()
  expect(bodies.map((body) => body.prompt)).toEqual(['quality\nportrait, sitting', 'quality\nportrait, sitting',
    'quality\nportrait, standing', 'quality\nportrait, standing'])
  expect(bodies.map((body) => body.seed)).toEqual(['42', '42', '42', '42'])
  expect(bodies[0]!.variationSeedStrength).toBe(0)
  expect(bodies[1]!.variationSeedStrength).toBe(0.5)
  expect(bodies[1]!.variationSeed).toBe(bodies[3]!.variationSeed)
  await page.reload()
  const images = await data.list<CharacterImage>('images', 'normal', { characterId: character.id })
  expect(images).toHaveLength(4)
  expect(images.map((image) => image.tags)).toEqual([['feliz', 'sentada'], ['feliz', 'sentada'], ['feliz', 'de pie'], ['feliz', 'de pie']])
  expect(images[0]!.generation).toEqual({ seed: 42 })
  expect(images[1]!.generation).toEqual({ seed: 42, variationSeed: bodies[1]!.variationSeed, variationSeedStrength: 0.5 })
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 850 })
    await page.getByTestId('character-swarm-toggle').click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByTestId('character-swarm-toggle').click()
  }
  await page.goto('/settings')
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar JSON', exact: true }).click()
  const download = await downloadEvent
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(exported.swarmPrompts).toHaveLength(2)
  expect(exported.characters.find((item: Character) => item.id === character.id).images[1].generation).toEqual(images[1]!.generation)
  await page.locator('input[type="file"][accept="application/json"]').setInputFiles({ name: 'conjunto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) })
  await expect.poll(async () => (await data.list<SwarmPrompt>('swarmPrompts')).length).toBe(4)
  await expect.poll(async () => (await data.list<CharacterImage>('images')).length).toBe(8)
  const importedImages = (await data.list<CharacterImage>('images')).filter((image) => image.characterId !== character.id)
  expect(importedImages.map((image) => image.generation)).toEqual(images.map((image) => image.generation))
})

test('muestra progreso, prompt actual y última imagen al generar un lote', async ({ page, data }) => {
  await data.patchSettings({ swarmBaseUrl: 'http://localhost:7801' })
  const character = await data.createCharacter()
  let calls = 0
  let release: (() => void) | undefined
  await page.route('**/api/swarm/catalog', (route) => route.fulfill({ json: CATALOG }))
  await page.route('**/api/swarm/generate', async (route) => {
    calls++
    if (calls === 2) await new Promise<void>((resolve) => { release = resolve })
    await route.fulfill({ contentType: 'image/png', body: PNG_BYTES }).catch(() => {})
  })

  await page.goto(`/characters/${character.id}`)
  await page.getByRole('button', { name: 'Crear imagen con SwarmUI' }).click()
  await page.getByLabel('Prompt de imagen (inglés y editable)').fill('portrait')
  await page.getByLabel('Número de imágenes').fill('2')
  await page.getByRole('button', { name: 'Generar imagen', exact: true }).click()

  const progress = page.getByRole('dialog', { name: 'Generando imágenes' })
  await expect(progress).toBeVisible()
  await expect(progress).toContainText('Imagen 1 de 2 completadas.')
  await expect(progress).toContainText('portrait')
  await expect(progress.getByRole('img', { name: 'Última imagen generada' })).toBeVisible()
  await expect(progress.getByRole('button', { name: 'Cancelar generación' })).toBeVisible()

  await progress.getByRole('button', { name: 'Cancelar generación' }).click()
  release?.()
  await expect(page.getByText(/Generación cancelada/)).toBeVisible()
})

test('edita y borra prompts sin mezclar catálogo normal y privado', async ({ page, data }) => {
  await data.patchSettings({ swarmBaseUrl: 'http://localhost:7801' })
  const prompt = { id: data.unique('prompt'), name: 'Prompt normal', prompt: 'portrait', tags: [], createdAt: 1, updatedAt: 1 }
  await expect(await page.request.put(`/api/data/swarmPrompts/${prompt.id}?scope=normal`, { data: prompt })).toBeOK()
  await expect(await page.request.put(`/api/data/swarmPrompts/${prompt.id}?scope=private`, { data: { ...prompt, name: 'Prompt privado' } })).toBeOK()
  await page.goto('/swarm-prompts')
  await page.getByRole('button', { name: 'Prompt normal', exact: true }).click()
  await page.getByLabel('Nombre', { exact: true }).fill('Normal editado')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Prompt guardado.', { exact: true })).toBeVisible()
  await page.goto('/settings')
  const trigger = page.getByRole('button', { name: 'Activar modo privado' })
  await trigger.click(); await trigger.click(); await trigger.click()
  await expect(page).toHaveURL('/')
  await page.getByRole('link', { name: 'Prompts SwarmUI', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Normal editado', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Prompt privado', exact: true }).click()
  await page.getByRole('button', { name: 'Borrar', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Borrar', exact: true }).click()
  await expect.poll(async () => (await data.list<SwarmPrompt>('swarmPrompts', 'private')).length).toBe(0)
  expect((await data.list<SwarmPrompt>('swarmPrompts'))[0]!.name).toBe('Normal editado')
})

test('detiene lotes al fallar, cancelar o salir sin borrar éxitos', async ({ page, data }) => {
  await data.patchSettings({ swarmBaseUrl: 'http://localhost:7801' })
  const character = await data.createCharacter()
  let calls = 0
  let release: (() => void) | undefined
  await page.route('**/api/swarm/catalog', (route) => route.fulfill({ json: CATALOG }))
  await page.route('**/api/swarm/generate', async (route) => {
    calls++
    if (calls === 1) return route.fulfill({ contentType: 'image/png', body: PNG_BYTES })
    if (calls === 2) return route.fulfill({ status: 502, json: { message: 'Fallo simulado' } })
    await new Promise<void>((resolve) => { release = resolve })
    await route.fulfill({ contentType: 'image/png', body: PNG_BYTES }).catch(() => {})
  })
  await page.goto(`/characters/${character.id}`)
  await page.getByTestId('character-swarm-toggle').click()
  await page.getByLabel('Prompt de imagen (inglés y editable)').fill('portrait')
  await page.getByLabel('Número de imágenes').fill('3')
  await page.getByRole('button', { name: 'Generar imagen', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Fallo simulado 1 guardadas; 2 pendientes.')
  expect(calls).toBe(2)
  await page.getByRole('button', { name: 'Generar imagen', exact: true }).click()
  await expect.poll(() => calls).toBe(3)
  await page.getByRole('button', { name: 'Cancelar generación' }).click()
  release!()
  await expect(page.getByText(/Generación cancelada/)).toBeVisible()
  await page.getByRole('button', { name: 'Generar imagen', exact: true }).click()
  await expect.poll(() => calls).toBe(4)
  await page.getByRole('link', { name: 'Personajes', exact: true }).click()
  release!()
  await expect(page).toHaveURL(/\/characters$/)
  expect(await data.list<CharacterImage>('images', 'normal', { characterId: character.id })).toHaveLength(1)
})

test('crea prompt editable y guarda la imagen generada en WebP', async ({ page, data }) => {
  const character = await data.createCharacter({
    imageGenerationPreset: '',
    imageGenerationLora: '',
    imageGenerationSeed: '',
    imageGenerationPromptPrefix: ''
  })
  const generatedByLlm = 'Alicia standing upright, wearing a blue coat, with a joyful expression.'
  const editedPrompt = 'Alicia in a dynamic standing pose, wearing a red travel coat, visibly determined.'
  const promptPrefix = 'masterpiece, detailed portrait'
  let generationBody: Record<string, unknown> | null = null
  let llmBody: Record<string, unknown> | null = null
  await data.patchSettings({ useChromeLlm: false, model: 'test-model', maxTokens: 1234, swarmBaseUrl: 'http://localhost:7801' })
  await page.route('**/api/swarm/catalog', (route) => route.fulfill({ json: CATALOG }))
  await page.route('**/api/llm/chat', (route) => {
    llmBody = route.request().postDataJSON() as Record<string, unknown>
    return route.fulfill({ json: { content: generatedByLlm, finishReason: 'stop' } })
  })
  await page.route('**/api/swarm/generate', async (route) => {
    generationBody = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ contentType: 'image/png', body: PNG_BYTES })
  })

  await page.goto(`/characters/${character.id}`)
  await expect(page.getByTestId('character-swarm-generator')).toHaveCount(0)
  await page.getByRole('button', { name: 'Crear imagen con SwarmUI' }).click()
  await expect(page.getByTestId('character-swarm-generator')).toBeVisible()
  await page.getByLabel('Preset SwarmUI').selectOption('Retrato')
  await expect(page.getByLabel('Modelo SwarmUI')).toBeVisible()
  await page.getByLabel('LoRA SwarmUI').selectOption('detail-lora')
  await page.getByLabel('Semilla SwarmUI').fill('9243353')
  await page.getByLabel('Prefijo del prompt').fill(promptPrefix)
  await page.getByLabel('Etiquetas para el prompt').fill('plano entero')
  await page.getByLabel('Etiquetas para el prompt').press('Enter')
  await page.getByLabel('Notas para el prompt').fill('Capa roja y gesto decidido.')
  await page.getByRole('button', { name: 'Crear prompt con IA' }).click()
  expect(llmBody?.maxTokens).toBe(1234)
  await expect(page.getByLabel('Prompt de imagen (inglés y editable)')).toHaveValue(generatedByLlm)
  await page.getByLabel('Prompt de imagen (inglés y editable)').fill(editedPrompt)
  await page.getByRole('button', { name: 'Generar imagen', exact: true }).click()

  await expect(page.getByText('Imagen generada y guardada en la galería.')).toBeVisible()
  expect(generationBody).toEqual({
    prompt: `${promptPrefix}\n${editedPrompt}`,
    preset: 'Retrato',
    model: 'model-a',
    lora: 'detail-lora',
    seed: '9243353',
    variationSeedStrength: 0
  })
  await expect.poll(async () => {
    const stored = await data.get<Character>('characters', character.id)
    return {
      preset: stored.imageGenerationPreset,
      lora: stored.imageGenerationLora,
      seed: stored.imageGenerationSeed,
      prefix: stored.imageGenerationPromptPrefix
    }
  }).toEqual({
    preset: 'Retrato',
    lora: 'detail-lora',
    seed: '9243353',
    prefix: promptPrefix
  })
  const images = await data.list<CharacterImage>('images', 'normal', {
    characterId: character.id
  })
  expect(images).toHaveLength(1)
  expect(images[0]).toMatchObject({ tags: ['plano entero'], isDefault: true, mimeType: 'image/webp', generation: { seed: 9243353 } })
})
