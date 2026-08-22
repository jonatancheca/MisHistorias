import { expect, test } from '@playwright/test'
import { ensureNsfwAuth } from './helpers/nsfwAuth.ts'

const PREMISE = 'Misma premisa jugable en Chat y VN por separado.'

test.describe('NSFW VN M3', () => {
  test('crear sesión VN, generate, save y formato inmutable', async ({ request }) => {
    await ensureNsfwAuth(request)

    const models = await request.get('/api/private/models')
    const modelAlias = ((await models.json()).models?.[0]?.alias as string) || 'style-v2'

    const created = await request.post('/api/private/sessions', {
      data: {
        title: 'VN smoke',
        premise: PREMISE,
        format: 'vn',
        duration: 'corta',
        tone: 'íntimo',
        perspective: 'segunda',
        interactionPolicy: 'lite',
        generationProfile: 'quick',
        modelAlias,
        cast: [
          {
            actorId: 'protagonist',
            name: 'Tú',
            role: 'protagonist',
            personality: '',
            isSelfInsert: true
          },
          {
            actorId: 'companion',
            name: 'Nora',
            role: 'character',
            personality: 'directa',
            isSelfInsert: false
          }
        ],
        interests: [],
        exclusions: []
      }
    })
    expect(created.ok()).toBeTruthy()
    const session = (await created.json()).session
    expect(session.format).toBe('vn')

    const generated = await request.post(`/api/private/sessions/${session.id}/generate`, {
      data: {
        input: { kind: 'speak', text: 'Qué pasa aquí' },
        modelAlias,
        generationProfile: 'quick'
      }
    })
    expect(generated.ok()).toBeTruthy()
    const attempt = (await generated.json()).attempt
    expect(attempt.state).toBe('ready')
    expect(attempt.envelope.format).toBe('vn')

    const accepted = await request.post(
      `/api/private/sessions/${session.id}/attempts/${attempt.id}/accept`,
      { data: {} }
    )
    expect(accepted.ok()).toBeTruthy()

    const play = await request.get(`/api/private/sessions/${session.id}`)
    const playBody = await play.json()
    const headBeatId = playBody.session?.headBeatId || playBody.play?.session?.headBeatId

    const saved = await request.post(`/api/private/sessions/${session.id}/vn-saves`, {
      data: {
        label: 'E2E manual',
        headBeatId,
        isAutosave: false,
        payload: { unitIndex: 0 }
      }
    })
    expect(saved.ok()).toBeTruthy()

    const saves = await request.get(`/api/private/sessions/${session.id}/vn-saves`)
    expect(saves.ok()).toBeTruthy()
    const saveList = (await saves.json()).saves as Array<{ label: string }>
    expect(saveList.some((item) => item.label === 'E2E manual')).toBeTruthy()

    // Chat hermano con la misma premisa (sesiones separadas, formato inmutable)
    const chat = await request.post('/api/private/sessions', {
      data: {
        title: 'Chat hermano',
        premise: PREMISE,
        format: 'chat',
        duration: 'corta',
        tone: 'íntimo',
        perspective: 'segunda',
        interactionPolicy: 'pause',
        generationProfile: 'quick',
        modelAlias,
        cast: session.cast,
        interests: [],
        exclusions: []
      }
    })
    expect(chat.ok()).toBeTruthy()
    expect((await chat.json()).session.format).toBe('chat')
  })
})
