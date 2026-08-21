import type { AppSettings, Sound } from '../../shared/types'
import { expect, test } from './fixtures'

const DEFAULT_PRIMARY_TAGS = [
  'pasos',
  'abrir puerta',
  'cerrar puerta',
  'timbre',
  'golpes puerta',
  'lluvia',
  'viento',
  'trueno',
  'fuego',
  'multitud'
]

function hasDefaultPack(sounds: Sound[]) {
  const tags = new Set(sounds.flatMap((sound) => sound.tags))
  return DEFAULT_PRIMARY_TAGS.every((tag) => tags.has(tag))
}

test('siembra pack normal, no repone borrados; trigger abre gate NSFW', async ({ page, data }) => {
  test.setTimeout(60_000)
  await data.patchSettings({ defaultSoundVersion: 0, privateDefaultSoundVersion: 0 })

  await page.goto('/sounds')
  await expect.poll(async () => {
    const response = await page.request.get('/api/settings')
    return ((await response.json()) as AppSettings).defaultSoundVersion
  }).toBe(1)
  await expect.poll(async () => hasDefaultPack(await data.list<Sound>('sounds'))).toBe(true)

  const normalSteps = (await data.list<Sound>('sounds')).find((sound) =>
    sound.tags.includes('pasos')
  )!
  const deleteNormal = await page.request.delete(
    `/api/data/sounds/${normalSteps.id}?scope=normal`
  )
  await expect(deleteNormal).toBeOK()
  await page.reload()
  await expect.poll(async () =>
    (await data.list<Sound>('sounds')).some((sound) => sound.id === normalSteps.id)
  ).toBe(false)

  // Colección privada permanece aislada (API); el trigger ya no entra en UI rosa
  const privateBefore = await data.list<Sound>('sounds', 'private')
  expect(privateBefore.every((sound) => sound.id !== normalSteps.id)).toBe(true)

  await page.goto('/settings')
  const privateTrigger = page.locator('button[aria-label="Activar modo privado"]')
  await privateTrigger.click({ clickCount: 3, delay: 80, force: true })
  await expect(page).toHaveURL('/private/login')
  await expect(page.locator('html')).toHaveClass(/nsfw-scope/)
})
