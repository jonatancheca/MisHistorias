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

test('recarga sonidos conservando el borrador nuevo', async ({ page, data }) => {
  const draftTag = data.unique('borrador-sonido')
  const externalTag = data.unique('sonido-externo')

  await page.goto('/sounds')
  await page.locator('input[placeholder="puerta, pasos"]').fill(draftTag)
  await data.createSound(null, [externalTag])
  await page.getByRole('button', { name: 'Recargar', exact: true }).click()

  await expect(page.getByTestId('sound-card').filter({ hasText: externalTag })).toBeVisible()
  await expect(page.getByRole('button', { name: `Quitar etiqueta ${draftTag}` })).toBeVisible()

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
})

test('siembra el pack en ambas colecciones sin reponer borrados', async ({ page, data }) => {
  test.setTimeout(60_000)
  await data.patchSettings({ defaultSoundVersion: 0, privateDefaultSoundVersion: 0 })

  await page.goto('/sounds')
  await expect.poll(async () => {
    const response = await page.request.get('/api/settings')
    return ((await response.json()) as AppSettings).defaultSoundVersion
  }).toBe(1)
  await expect.poll(async () => hasDefaultPack(await data.list<Sound>('sounds'))).toBe(true)
  const normalSteps = (await data.list<Sound>('sounds'))
    .find((sound) => sound.tags.includes('pasos'))!
  const deleteNormal = await page.request.delete(
    `/api/data/sounds/${normalSteps.id}?scope=normal`
  )
  await expect(deleteNormal).toBeOK()
  await page.reload()
  await expect.poll(async () =>
    (await data.list<Sound>('sounds')).some((sound) => sound.id === normalSteps.id)
  ).toBe(false)

  await page.goto('/settings')
  const privateTrigger = page.getByRole('button', { name: 'Activar modo privado' })
  await privateTrigger.click()
  await privateTrigger.click()
  await privateTrigger.click()
  await expect(page).toHaveURL('/settings')
  await page.getByRole('link', { name: 'Sonidos' }).click()
  await expect.poll(async () => {
    const response = await page.request.get('/api/settings')
    return ((await response.json()) as AppSettings).privateDefaultSoundVersion
  }).toBe(1)
  await expect.poll(async () => hasDefaultPack(await data.list<Sound>('sounds', 'private')))
    .toBe(true)

  const privateRain = (await data.list<Sound>('sounds', 'private'))
    .find((sound) => sound.tags.includes('lluvia'))!
  const deletePrivate = await page.request.delete(
    `/api/data/sounds/${privateRain.id}?scope=private`
  )
  await expect(deletePrivate).toBeOK()
  await page.reload()
  await page.goto('/settings')
  const privateTriggerAgain = page.getByRole('button', { name: 'Activar modo privado' })
  await privateTriggerAgain.click()
  await privateTriggerAgain.click()
  await privateTriggerAgain.click()
  await expect(page).toHaveURL('/settings')
  await page.getByRole('link', { name: 'Sonidos' }).click()
  await expect.poll(async () =>
    (await data.list<Sound>('sounds', 'private')).some((sound) => sound.id === privateRain.id)
  ).toBe(false)

  await page.locator('main').press('Control+Alt+p')
  await page.getByRole('link', { name: 'Sonidos' }).click()
  expect((await data.list<Sound>('sounds')).some((sound) => sound.id === normalSteps.id))
    .toBe(false)
})

test('muestra tarjetas de sonido compactas y responsive', async ({ page, data }) => {
  const character = await data.createCharacter()
  await data.createSound(character, ['pasos', 'caminar'])

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/characters/${character.id}`)
  const card = page.getByTestId('sound-card')
  await expect(card).toBeVisible()
  expect(await card.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(80)

  await page.setViewportSize({ width: 390, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  expect(await card.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(190)
})
