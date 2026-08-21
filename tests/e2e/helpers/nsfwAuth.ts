import type { APIRequestContext } from '@playwright/test'
import { expect } from '@playwright/test'

export const E2E_NSFW_USER = 'e2e-admin'
export const E2E_NSFW_PASS = 'e2e-pass-12345'

export async function ensureNsfwAuth(request: APIRequestContext) {
  await request.patch('/api/settings', { data: { mockMode: true } })
  const status = await request.get('/api/private/auth/status')
  const body = await status.json()

  if (body.mode === 'session') return

  if (body.mode === 'bootstrap') {
    const boot = await request.post('/api/private/auth/bootstrap', {
      data: { username: E2E_NSFW_USER, password: E2E_NSFW_PASS }
    })
    expect(boot.ok()).toBeTruthy()
    return
  }

  for (const candidate of [
    { username: E2E_NSFW_USER, password: E2E_NSFW_PASS },
    { username: 'm1admin', password: 'm1-pass-12345' }
  ]) {
    const login = await request.post('/api/private/auth/login', { data: candidate })
    if (login.ok()) return
  }

  throw new Error('No se pudo autenticar en /private para E2E')
}
