import type { Story } from '../../shared/types'
import { test, expect } from './fixtures'

test('planteamiento mayor que la capacidad se compacta por bloques sin omisiones', async ({ page, data }) => {
  await data.patchSettings({ mockMode: false, model: 'test-model', useChromeLlm: false,
    privateUseChromeLlm: null, privateLlmSettingsEnabled: false, responseSpeed: 'instant',
    contextUnit: 'tokens', historyBudget: 0, contextTokenBudget: 9000, maxTokens: 100,
    narrativePrompt: 'Narra la historia.', compactionPrompt: 'Resume los datos recibidos.' })
  await page.route('**/api/llm/model-status?*', route => route.fulfill({ json: { loaded: true } }))
  type ChatMessage = { role: string; content: string }
  const size = (messages: ChatMessage[]) => messages.reduce((sum, item) => sum + item.content.length, 0)
  await page.route('**/api/llm/context', route => route.fulfill({ json: {
    tokens: size(route.request().postDataJSON().messages), capacity: 10000, model: 'test-model'
  } }))
  const premise = 'Mundo medieval sin magia. 😀 '.repeat(1200)
  const story = await data.createStory({ characters: [], premise, title: 'QA: Planteamiento extenso' })
  const old = await data.createMessage({ story, role: 'assistant', raw: 'La aventura comienza.',
    segments: [{ type: 'narration', text: 'La aventura comienza.' }] })
  const received: ChatMessage[] = []
  let calls = 0
  await page.route('**/api/llm/chat', async route => {
    const request = route.request().postDataJSON()
    expect(request.operation).toBe('story.compaction')
    expect(size(request.messages)).toBeLessThanOrEqual(9900)
    expect(request.messages[0].content).toContain('El resumen sustituirá tanto el planteamiento como el historial')
    const body = JSON.parse(request.messages[1].content)
    expect(body.previousSummary).toBe(calls ? 'Mundo medieval sin magia; la aventura comienza.' : '')
    received.push(...body.history)
    calls++
    expect((await data.get<Story>('stories', story.id)).contextSummary).toBeFalsy()
    await route.fulfill({ json: { content: 'Mundo medieval sin magia; la aventura comienza.', finishReason: 'stop' } })
  })
  await page.goto(`/stories/${story.id}`)
  await page.locator('[data-testid^="story-context-"]').first().click()
  await page.getByRole('button', { name: 'Compactar historia', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Compactar historia', exact: true })
  await dialog.getByRole('button', { name: 'Compactar', exact: true }).click()
  await dialog.getByRole('button', { name: 'Compactar por bloques', exact: true }).click()
  await expect(dialog.getByTestId('manual-compaction-after')).toBeVisible()
  expect(calls).toBeGreaterThan(1)
  expect(received.filter(item => item.role === 'system').map(item => item.content).join('')).toBe(`Planteamiento de la historia:\n${premise.trim()}`)
  expect(received.filter(item => item.role === 'assistant')).toEqual([{ role: 'assistant', content: old.raw }])
  expect(await data.get<Story>('stories', story.id)).toMatchObject({ premise, contextSummary: 'Mundo medieval sin magia; la aventura comienza.', contextSummaryThroughMessageId: old.id })
})
