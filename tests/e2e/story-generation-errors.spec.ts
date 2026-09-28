import type { Page } from '@playwright/test'
import type { LlmDebugTrace, Message } from '../../shared/types'
import { expect, test, type TestDataFactory } from './fixtures'

async function prepareStory(page: Page, data: TestDataFactory) {
  await data.patchSettings({
    mockMode: false, model: 'test-model', useChromeLlm: false, privateUseChromeLlm: null,
    responseSpeed: 'instant', visualNovelManualAdvance: false, userName: 'Vera', historyBudget: 100_000
  })
  const character = await data.createCharacter()
  const background = await data.createBackground()
  const story = await data.createStory({ characters: [character], background, visualMode: true })
  const feedback = page.getByTestId('visual-generation-feedback')
  const composer = page.getByPlaceholder('Escribe lo que haces o dices…')
  return { story, character, background, feedback, composer }
}

function httpError(message = 'Servidor LLM no disponible.') {
  return { status: 502, json: { statusCode: 502, message, data: { detail: 'Bad Gateway' } } }
}

test.describe('errores de generación en Novela Visual', () => {
  test('502 persistente, reintento sin duplicados, borrador conservado y panel responsive', async ({ page, data }) => {
    const { story, feedback, composer } = await prepareStory(page, data)
    const requests: Array<{ messages: unknown[] }> = []
    await page.route('**/api/llm/chat', async (route) => {
      requests.push(route.request().postDataJSON())
      await route.fulfill(requests.length === 1
        ? httpError()
        : { json: { content: 'La puerta vuelve a abrirse.', finishReason: 'stop' } })
    })
    await page.goto(`/stories/${story.id}`)
    await composer.fill('Abro la puerta.')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(feedback).toContainText('HTTP 502 · Servidor LLM no disponible.')
    await expect(feedback.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible()
    const user = (await data.list<Message>('messages', 'normal', { storyId: story.id }))[0]!
    const frameText = await page.getByTestId('visual-novel-frame').innerText()
    await page.getByTestId('visual-mode-toggle').click()
    await expect(page.getByTestId('story-scroller').getByRole('alert')).toContainText('Servidor LLM no disponible.')
    await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toHaveCount(0)
    await page.getByTestId('visual-mode-toggle').click()
    await expect(feedback).toBeVisible()
    await expect(page.getByTestId('visual-novel-frame')).toHaveText(frameText)
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(feedback).toBeInViewport()
      await expect(composer).toBeInViewport()
      const panelBounds = (await feedback.boundingBox())!
      const inputBounds = (await composer.boundingBox())!
      expect(panelBounds.y + panelBounds.height).toBeLessThanOrEqual(inputBounds.y)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
      if (width === 390) await page.screenshot({ path: test.info().outputPath('error-390.png') })
    }
    await page.reload()
    await expect(feedback).toContainText('HTTP 502')
    await composer.fill('Borrador para después.')
    await feedback.getByRole('button', { name: 'Reintentar', exact: true }).click()
    await expect(feedback).toBeHidden()
    await expect(composer).toHaveValue('Borrador para después.')
    await expect(page.getByTestId('visual-novel-frame')).toContainText('La puerta vuelve a abrirse.')
    const messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(messages[0]!.id).toBe(user.id)
    expect(requests).toHaveLength(2)
    expect(requests[1]!.messages).toEqual(requests[0]!.messages)
    await page.reload()
    await expect(feedback).toBeHidden()
  })

  test('inicio automático fallido se recupera al reabrir sin crear mensaje del usuario', async ({ page, data }) => {
    const { story, feedback } = await prepareStory(page, data)
    let calls = 0
    await page.route('**/api/llm/chat', async (route) => {
      calls += 1
      await route.fulfill(calls === 1 ? httpError() : { json: { content: 'La aventura comienza.', finishReason: 'stop' } })
    })
    await page.goto(`/stories/${story.id}`)
    await page.getByRole('button', { name: 'Deja que la história empiece sola' }).first().click()
    await expect(feedback).toContainText('HTTP 502')
    expect(await data.list<Message>('messages', 'normal', { storyId: story.id })).toHaveLength(0)
    await page.reload()
    await feedback.getByRole('button', { name: 'Reintentar', exact: true }).click()
    await expect(page.getByTestId('visual-novel-frame')).toContainText('La aventura comienza.')
    const messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
    expect(messages.map((message) => message.role)).toEqual(['assistant'])
    expect(calls).toBe(2)
  })

  for (const mode of ['continue', 'auto'] as const) {
    test(`reintento de ${mode} conserva turnos anteriores, modo e instrucciones de imagen`, async ({ page, data }) => {
      const { story, character, feedback } = await prepareStory(page, data)
      const user = await data.createMessage({ story, role: 'user', raw: 'Entro.' })
      const first = await data.createMessage({ story, role: 'assistant', raw: 'Llegas al patio.', segments: [{ type: 'narration', text: 'Llegas al patio.' }] })
      const second = await data.createMessage({ story, role: 'assistant', generationMode: 'continue', raw: 'Una fuente suena.', segments: [{ type: 'narration', text: 'Una fuente suena.' }] })
      const image = await data.createImage(character, ['feliz'])
      await expect(await page.request.put(`/api/data/stories/${story.id}?scope=normal`, {
        data: { ...story, pendingImageInstructions: [{ characterId: character.id, imageId: image.id, tags: ['feliz'] }] }
      })).toBeOK()
      const requests: Array<{ messages: unknown[] }> = []
      await page.route('**/api/llm/chat', async (route) => {
        requests.push(route.request().postDataJSON())
        await route.fulfill(requests.length === 1 ? httpError() : { json: { content: 'La escena continúa.', finishReason: 'stop' } })
      })
      await page.goto(`/stories/${story.id}`)
      const frame = page.getByTestId('visual-novel-frame')
      await expect(frame).toContainText('Una fuente suena.')
      await page.getByTestId(mode === 'continue' ? 'continue-button' : 'auto-button').click()
      await expect(feedback).toContainText('HTTP 502')
      await expect(frame).toContainText('Una fuente suena.')
      await expect(page.getByTestId('pending-image-instructions')).toBeVisible()
      await page.reload()
      await feedback.getByRole('button', { name: 'Reintentar', exact: true }).click()
      await expect(frame).toContainText('La escena continúa.')
      await expect(page.getByTestId('pending-image-instructions')).toBeHidden()
      const messages = await data.list<Message>('messages', 'normal', { storyId: story.id })
      expect(messages.map((message) => message.id).slice(0, 3)).toEqual([user.id, first.id, second.id])
      expect(messages).toHaveLength(4)
      const traces = await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })
      expect(traces.at(-1)!.request.generation?.mode).toBe(mode)
      expect(requests).toHaveLength(2)
      expect(requests[1]!.messages).toEqual(requests[0]!.messages)
    })
  }

  test('respuesta vacía permite varios reintentos sin duplicar el envío', async ({ page, data }) => {
    const { story, feedback, composer } = await prepareStory(page, data)
    let calls = 0
    await page.route('**/api/llm/chat', async (route) => {
      calls += 1
      await route.fulfill({ json: { content: calls < 3 ? '' : 'Contenido recuperado.', finishReason: 'stop' } })
    })
    await page.goto(`/stories/${story.id}`)
    await composer.fill('Espero respuesta.')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(feedback).toContainText('El modelo no devolvió contenido visible.')
    await feedback.getByRole('button', { name: 'Reintentar', exact: true }).click()
    await expect.poll(() => calls).toBe(2)
    await expect(feedback).toContainText('El modelo no devolvió contenido visible.')
    await page.reload()
    await feedback.getByRole('button', { name: 'Reintentar', exact: true }).click()
    await expect(page.getByTestId('visual-novel-frame')).toContainText('Contenido recuperado.')
    expect(await data.list<Message>('messages', 'normal', { storyId: story.id })).toHaveLength(2)
    expect(calls).toBe(3)
  })

  test('texto truncado se conserva con aviso persistente sin reintento', async ({ page, data }) => {
    const { story, feedback, composer } = await prepareStory(page, data)
    await page.route('**/api/llm/chat', async (route) => {
      await route.fulfill({ json: { content: 'Esta respuesta quedó a medias.', finishReason: 'length' } })
    })
    await page.goto(`/stories/${story.id}`)
    await composer.fill('Continúa la escena.')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(feedback).toContainText('Se ha conservado el contenido parcial.')
    await expect(feedback.getByRole('button', { name: 'Reintentar', exact: true })).toHaveCount(0)
    await expect(page.getByTestId('visual-novel-frame')).toContainText('Esta respuesta quedó a medias.')
    await page.reload()
    await expect(feedback).toContainText('Se ha conservado el contenido parcial.')
    await expect(page.getByTestId('visual-novel-frame')).toContainText('Esta respuesta quedó a medias.')
    expect(await data.list<Message>('messages', 'normal', { storyId: story.id })).toHaveLength(2)
  })

  test('reintento admite una sola llamada y cancelación no revive error anterior', async ({ page, data }) => {
    const { story, feedback, composer } = await prepareStory(page, data)
    const gate = Promise.withResolvers<undefined>()
    let calls = 0
    await page.route('**/api/llm/chat', async (route) => {
      calls += 1
      if (calls === 1) return route.fulfill(httpError())
      await gate.promise
      await route.fulfill({ json: { content: 'Respuesta cancelada.', finishReason: 'stop' } }).catch(() => {})
    })
    await page.goto(`/stories/${story.id}`)
    await composer.fill('Espero.')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(feedback).toContainText('HTTP 502')
    await feedback.getByRole('button', { name: 'Reintentar', exact: true }).evaluate((button: HTMLButtonElement) => {
      button.click()
      button.click()
    })
    await expect.poll(() => calls).toBe(2)
    await expect(feedback).toBeHidden()
    await page.getByRole('button', { name: 'Parar', exact: true }).click()
    gate.resolve(undefined)
    await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible()
    await expect(feedback).toBeHidden()
    await page.reload()
    await expect(feedback).toBeHidden()
    expect(calls).toBe(2)
    const traces = await data.list<LlmDebugTrace>('llmDebugTraces', 'normal', { storyId: story.id })
    expect(traces.filter((trace) => trace.status === 'error')).toHaveLength(1)
    expect(traces[0]!.request.generation?.dismissed).toBe(true)
  })

  for (const failure of ['transporte', 'respuesta vacía'] as const) {
    test(`${failure} con fallo de guardado de traza sigue visible y permite reintentar`, async ({ page, data }) => {
      const { story, feedback, composer } = await prepareStory(page, data)
      await page.route('**/api/data/llmDebugTraces/*', async (route) => {
        if (route.request().method() === 'PUT') return route.fulfill({ status: 500, json: { message: 'Traza no disponible' } })
        await route.fallback()
      })
      await page.route('**/api/llm/chat', async (route) => {
        if (failure === 'transporte') await route.abort('failed')
        else await route.fulfill({ json: { content: '', finishReason: 'stop' } })
      })
      await page.goto(`/stories/${story.id}`)
      await composer.fill('Prueba de recuperación.')
      await page.getByRole('button', { name: 'Enviar', exact: true }).click()
      await expect(feedback).toBeVisible()
      if (failure === 'respuesta vacía') await expect(feedback).toContainText('El modelo no devolvió contenido visible.')
      await expect(feedback.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible()
      expect(await data.list<Message>('messages', 'normal', { storyId: story.id })).toHaveLength(1)
      await page.unroute('**/api/data/llmDebugTraces/*')
      await page.unroute('**/api/llm/chat')
      await page.route('**/api/llm/chat', async (route) => {
        await route.fulfill({ json: { content: 'La respuesta se recuperó.', finishReason: 'stop' } })
      })
      await feedback.getByRole('button', { name: 'Reintentar', exact: true }).click()
      await expect(page.getByTestId('visual-novel-frame')).toContainText('La respuesta se recuperó.')
      await expect(feedback).toBeHidden()
      expect(await data.list<Message>('messages', 'normal', { storyId: story.id })).toHaveLength(2)
    })
  }
})
