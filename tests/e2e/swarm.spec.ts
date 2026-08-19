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
  await page.getByLabel('Token de SwarmUI (opcional)').fill('token-prueba')
  await expect(page.getByText('Guardado', { exact: true })).toBeVisible()
  const publicSettings = await page.request.get('/api/settings')
  const storedSettings = await publicSettings.json() as AppSettings
  expect(storedSettings.swarmAuthToken).toBe('')
  expect(storedSettings.swarmAuthConfigured).toBe(true)
  const secret = await page.request.post('/api/settings/swarm-token')
  expect(await secret.json()).toEqual({ swarmAuthToken: 'token-prueba' })

  await page.getByRole('button', { name: 'Probar conexión SwarmUI' }).click()
  await expect(page.getByText(/SwarmUI test-1\.0: 2 modelos, 1 LoRAs y 2 presets/)).toBeVisible()
  await expect(page.getByText('Modelos (2)')).toBeVisible()
  await expect(page.getByText('LoRAs (1)')).toBeVisible()
  await expect(page.getByText('Presets (2)')).toBeVisible()

  const prompt = 'Edited temporary prompt with standing pose, coat and joyful expression.'
  await page.getByLabel('Prompt de prueba').fill(prompt)
  await page.getByRole('button', { name: 'Generar imagen de prueba' }).click()
  await expect(page.getByTestId('swarm-test-preview')).toBeVisible()
  expect(generationBody).toEqual({ prompt, preset: 'Retrato' })
})

test('crea prompt editable y guarda la imagen generada en WebP', async ({ page, data }) => {
  const character = await data.createCharacter({ imageGenerationPreset: '' })
  const generatedByLlm = 'Alicia standing upright, wearing a blue coat, with a joyful expression.'
  const editedPrompt = 'Alicia in a dynamic standing pose, wearing a red travel coat, visibly determined.'
  let generationBody: Record<string, unknown> | null = null
  await data.patchSettings({ useChromeLlm: false, model: 'test-model' })
  await page.route('**/api/swarm/catalog', (route) => route.fulfill({ json: CATALOG }))
  await page.route('**/api/llm/chat', (route) => route.fulfill({
    json: { content: generatedByLlm, finishReason: 'stop' }
  }))
  await page.route('**/api/swarm/generate', async (route) => {
    generationBody = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ contentType: 'image/png', body: PNG_BYTES })
  })

  await page.goto(`/characters/${character.id}`)
  await page.getByRole('button', { name: 'Cargar catálogo SwarmUI' }).click()
  await page.getByLabel('Preset SwarmUI').fill('Retrato')
  await page.getByLabel('Etiquetas para el prompt').fill('plano entero')
  await page.getByLabel('Etiquetas para el prompt').press('Enter')
  await page.getByLabel('Notas para el prompt').fill('Capa roja y gesto decidido.')
  await page.getByRole('button', { name: 'Crear prompt con IA' }).click()
  await expect(page.getByLabel('Prompt de imagen (inglés y editable)')).toHaveValue(generatedByLlm)
  await page.getByLabel('Prompt de imagen (inglés y editable)').fill(editedPrompt)
  await page.getByRole('button', { name: 'Generar imagen', exact: true }).click()

  await expect(page.getByText('Imagen generada y guardada en la galería.')).toBeVisible()
  expect(generationBody).toEqual({ prompt: editedPrompt, preset: 'Retrato' })
  await expect.poll(async () =>
    (await data.get<Character>('characters', character.id)).imageGenerationPreset
  ).toBe('Retrato')
  const images = await data.list<CharacterImage>('images', 'normal', {
    characterId: character.id
  })
  expect(images).toHaveLength(1)
  expect(images[0]).toMatchObject({ tags: ['neutral'], isDefault: true, mimeType: 'image/webp' })
})
