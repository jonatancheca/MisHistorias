import { createServer } from 'node:http'
import { expect, test } from './fixtures'

for (const scope of ['normal', 'private'] as const) {
  test(`Load IA junto al selector guarda, descarga y carga; ámbito ${scope}`, async ({ page, data }) => {
    const model = `modelo-${scope}-con-un-nombre-largo-para-validar-el-selector`
    const actions: string[] = []
    let loaded = false
    let failUnload = false
    const releaseUnload = Promise.withResolvers<undefined>()
    const server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/v1/models') {
        response.end(JSON.stringify({ data: [{ id: 'anterior' }, { id: model }] }))
        return
      }
      expect(request.headers.authorization).toBe(`Bearer ${scope}-secret`)
      if (request.method === 'GET') {
        response.end(JSON.stringify({ models: [
          { key: 'anterior', type: 'llm', loaded_instances: [] },
          { key: model, type: 'llm', loaded_instances: loaded ? [{ id: 'elegido' }] : [] },
          { key: 'otro', type: 'llm', loaded_instances: [{ id: 'otra-instancia' }] },
          { key: 'embedding', type: 'embedding', loaded_instances: [{ id: 'embedding-instancia' }] }
        ] }))
        return
      }
      const chunks: Uint8Array[] = []
      for await (const chunk of request) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model?: string; instance_id?: string }
      if (request.url === '/api/v1/models/unload') {
        actions.push(`unload:${body.instance_id}`)
        await releaseUnload.promise
        if (failUnload) {
          response.statusCode = 503
          response.end('{"error":"instancia ocupada"}')
        } else {
          response.end(JSON.stringify({ instance_id: body.instance_id }))
        }
        return
      }
      expect(request.url).toBe('/api/v1/models/load')
      actions.push(`load:${body.model}`)
      loaded = true
      response.end(JSON.stringify({ status: 'loaded', instance_id: 'elegido' }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Puerto de prueba no disponible')
    try {
      const baseUrl = `http://127.0.0.1:${address.port}`
      await data.patchSettings({
        baseUrl, apiKey: 'normal-secret', model: 'anterior', mockMode: false, useChromeLlm: false,
        privateLlmSettingsEnabled: true, privateBaseUrl: baseUrl, privateApiKey: 'private-secret',
        privateModel: 'anterior', privateUseChromeLlm: false
      })
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto('/settings#llm')
      if (scope === 'private') {
        const trigger = page.getByRole('button', { name: 'Activar modo privado' })
        for (let click = 0; click < 3; click++) await trigger.click()
        await expect(page.locator('html')).toHaveClass(/private-scope/)
      }
      const llm = page.getByTestId('llm-settings')
      const load = llm.getByRole('button', { name: 'Load IA', exact: true })
      await expect(load).toBeVisible()
      await llm.getByRole('button', { name: 'Probar conexión' }).click()
      const selector = llm.getByLabel('Modelo', { exact: true })
      await expect(selector).toHaveJSProperty('tagName', 'SELECT')
      await selector.selectOption(model)
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 800 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        const layout = await selector.evaluate(element => {
          const selectBox = element.getBoundingClientRect()
          const button = element.parentElement?.querySelector('button')
          if (!button) throw new Error('Falta el botón junto al selector')
          const loadBox = button.getBoundingClientRect()
          return {
            gap: loadBox.x - selectBox.right,
            centerOffset: Math.abs(loadBox.y + loadBox.height / 2 - selectBox.y - selectBox.height / 2)
          }
        })
        expect(layout.gap).toBeGreaterThan(0)
        expect(layout.centerOffset).toBeLessThan(1)
      }
      await load.click()
      const busy = llm.getByRole('button', { name: 'Cargando IA…', exact: true })
      await expect(busy).toBeDisabled()
      await expect(busy).toHaveAttribute('aria-busy', 'true')
      await expect.poll(() => actions).toEqual(['unload:otra-instancia'])
      releaseUnload.resolve(undefined)
      await expect(llm.getByRole('status')).toHaveText('Modelo cargado en LM Studio.')
      expect(actions).toEqual(['unload:otra-instancia', 'unload:embedding-instancia', `load:${model}`])

      actions.length = 0
      await load.click()
      await expect(llm.getByRole('status')).toHaveText('El modelo configurado ya está cargado en LM Studio.')
      expect(actions).toEqual([])

      loaded = false
      failUnload = true
      await load.click()
      await expect(llm.getByRole('alert')).toContainText('Se ha cancelado la carga del modelo.')
      expect(actions).toEqual(['unload:otra-instancia'])
      await expect(load).toBeEnabled()
      actions.length = 0
      failUnload = false
      await load.click()
      await expect(llm.getByRole('status')).toHaveText('Modelo cargado en LM Studio.')
      expect(actions).toEqual(['unload:otra-instancia', 'unload:embedding-instancia', `load:${model}`])
    } finally {
      releaseUnload.resolve(undefined)
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
}
