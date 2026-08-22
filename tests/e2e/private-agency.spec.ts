import { expect, test } from '@playwright/test'
import { ensureNsfwAuth } from './helpers/nsfwAuth.ts'

test.describe('NSFW Agency M2/M6', () => {
  test('reroll, fork y vn save vía API autenticada', async ({ request }) => {
    await ensureNsfwAuth(request)

    const models = await request.get('/api/private/models')
    expect(models.ok()).toBeTruthy()
    const modelAlias = ((await models.json()).models?.[0]?.alias as string) || 'style-v2'

    const created = await request.post('/api/private/sessions', {
      data: {
        title: 'Agency smoke',
        premise: 'Una terraza y una decisión',
        format: 'vn',
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
            actorId: 'other',
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
    const sessionId = (await created.json()).session.id as string

    const generated = await request.post(`/api/private/sessions/${sessionId}/generate`, {
      data: {
        input: { kind: 'act', text: 'acercarte' },
        modelAlias,
        generationProfile: 'quick'
      }
    })
    expect(generated.ok()).toBeTruthy()
    const attemptId = (await generated.json()).attempt.id as string

    const reroll = await request.post(`/api/private/sessions/${sessionId}/reroll`, {
      data: { attemptId, modelAlias, generationProfile: 'quick' }
    })
    expect(reroll.ok()).toBeTruthy()
    const siblingId = (await reroll.json()).attempt.id as string

    const accepted = await request.post(
      `/api/private/sessions/${sessionId}/attempts/${siblingId}/accept`
    )
    expect(accepted.ok()).toBeTruthy()

    const play = await request.get(`/api/private/sessions/${sessionId}`)
    const beatId = (await play.json()).beats?.[0]?.id as string
    expect(beatId).toBeTruthy()

    const fork = await request.post(`/api/private/beats/${beatId}/fork`, {
      data: { branchLabel: 'rama-a' }
    })
    expect(fork.ok()).toBeTruthy()

    const save = await request.post(`/api/private/sessions/${sessionId}/vn-saves`, {
      data: {
        label: 'manual-e2e',
        headBeatId: beatId,
        payload: { unitCursor: 0 }
      }
    })
    expect(save.ok()).toBeTruthy()
  })
})
