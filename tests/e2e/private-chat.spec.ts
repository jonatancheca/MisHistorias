import { expect, test } from '@playwright/test'
import { ensureNsfwAuth } from './helpers/nsfwAuth.ts'

test.describe('NSFW Chat M3', () => {
  test('crear sesión Chat y generar envelope mock', async ({ request }) => {
    await ensureNsfwAuth(request)

    const models = await request.get('/api/private/models')
    const modelAlias = ((await models.json()).models?.[0]?.alias as string) || 'style-v2'

    const created = await request.post('/api/private/sessions', {
      data: {
        title: 'Chat smoke',
        premise: 'Mensajes cortos en una terraza',
        format: 'chat',
        duration: 'corta',
        tone: 'íntimo',
        perspective: 'segunda',
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
    expect(session.format).toBe('chat')

    const generated = await request.post(`/api/private/sessions/${session.id}/generate`, {
      data: {
        input: { kind: 'speak', text: '¿qué miras?' },
        modelAlias,
        generationProfile: 'quick'
      }
    })
    expect(generated.ok()).toBeTruthy()
    const attempt = (await generated.json()).attempt
    expect(attempt.state).toBe('ready')
    expect(attempt.envelope.format).toBe('chat')
  })
})
