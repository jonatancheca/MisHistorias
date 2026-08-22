import { expect, test } from '@playwright/test'
import { ensureNsfwAuth } from './helpers/nsfwAuth.ts'

test.describe('NSFW Story M1', () => {
  test('crear sesión Story, generar mock, aceptar beat', async ({ request }) => {
    await ensureNsfwAuth(request)

    const models = await request.get('/api/private/models')
    const modelAlias = ((await models.json()).models?.[0]?.alias as string) || 'style-v2'

    const created = await request.post('/api/private/sessions', {
      data: {
        title: 'Story smoke',
        premise: 'Una terraza al anochecer y una conversación que no debería ocurrir.',
        format: 'story',
        duration: 'medium',
        tone: 'sensual',
        perspective: 'second',
        interactionPolicy: 'pause',
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
            name: 'Alex',
            role: 'character',
            personality: 'Directo',
            isSelfInsert: false
          }
        ],
        interests: ['tensión'],
        exclusions: []
      }
    })
    expect(created.ok()).toBeTruthy()
    const session = (await created.json()).session
    expect(session.format).toBe('story')
    expect(session.ownerUserId).toBeTruthy()

    const generated = await request.post(`/api/private/sessions/${session.id}/generate`, {
      data: {
        input: { kind: 'speak', text: 'Te miro en silencio.' },
        modelAlias,
        generationProfile: 'quick'
      }
    })
    expect(generated.ok()).toBeTruthy()
    const attempt = (await generated.json()).attempt
    expect(attempt.state).toBe('ready')
    expect(attempt.envelope.format).toBe('story')

    const accepted = await request.post(
      `/api/private/sessions/${session.id}/attempts/${attempt.id}/accept`,
      { data: {} }
    )
    expect(accepted.ok()).toBeTruthy()

    const play = await request.get(`/api/private/sessions/${session.id}`)
    expect(play.ok()).toBeTruthy()
    const body = await play.json()
    const beats = body.beats || body.play?.beats || []
    expect(beats.length).toBeGreaterThanOrEqual(1)
  })
})
