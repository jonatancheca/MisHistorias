import type { AppSettings, Character, CharacterImage } from '../../shared/types'
import { expect, PNG_BYTES, test } from './fixtures'

const CATALOG = {
  version: 'test-1.0',
  models: ['model-a', 'model-b'],
  loras: ['detail-lora'],
  presets: ['Retrato', 'Cuerpo entero']
}

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
  await data.patchSettings({ useChromeLlm: false, model: 'test-model', maxTokens: 1234 })
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
    seed: '9243353'
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
  expect(images[0]).toMatchObject({ tags: ['neutral'], isDefault: true, mimeType: 'image/webp' })
})
