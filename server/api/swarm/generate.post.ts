import { generateSwarmImage, type SwarmProxyError } from '../../utils/swarm'
import { recordOperationalError } from '../../utils/errorTraces'
import { getStorage } from '../../utils/storage'
import { sanitizeSwarmDiagnostic } from '../../../shared/utils/swarmError'

export default defineEventHandler(async (event) => {
  const rawBody = await readBody(event)
  const invalidRequest = (message: string) => createError({
    statusCode: 400, message,
    data: { message, diagnostic: sanitizeSwarmDiagnostic({
      target: 'proxy', operation: '/api/swarm/generate (validación)',
      request: rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? rawBody : null,
      requestSent: false, response: null, message
    }) }
  })
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    throw invalidRequest('Petición no válida')
  }
  const body = rawBody as Record<string, unknown>
  const prompt = typeof body.prompt === 'string' ? body.prompt : ''
  const preset = typeof body.preset === 'string' ? body.preset : ''
  const model = typeof body.model === 'string' ? body.model : ''
  const lora = typeof body.lora === 'string' ? body.lora : ''
  const seedValue = typeof body.seed === 'number'
    ? body.seed
    : typeof body.seed === 'string' && body.seed.trim()
      ? Number(body.seed.trim())
      : undefined
  if (!prompt.trim() || prompt.length > 100_000 || (!preset.trim() && !model.trim())) {
    throw invalidRequest('Indica un prompt y un preset o modelo')
  }
  if (seedValue !== undefined && (!Number.isSafeInteger(seedValue) || seedValue < 0)) {
    throw invalidRequest('La semilla debe ser un entero no negativo')
  }

  const variationSeed = body.variationSeed
  const variationSeedStrength = body.variationSeedStrength
  if ((variationSeed !== undefined && (typeof variationSeed !== 'number' || !Number.isInteger(variationSeed) || variationSeed < 0 || variationSeed > 0xffffffff)) ||
    (variationSeedStrength !== undefined && (typeof variationSeedStrength !== 'number' || !Number.isFinite(variationSeedStrength) || variationSeedStrength < 0 || variationSeedStrength > 1 ||
      (variationSeedStrength > 0 && variationSeed === undefined)))) {
    throw invalidRequest('Variación de semilla no válida')
  }
  const settings = getStorage().readSettings()
  const abortController = new AbortController()
  const abort = () => abortController.abort()
  const abortIfResponseClosed = () => {
    if (!event.node.res.writableEnded) abort()
  }
  event.node.req.once('aborted', abort)
  event.node.res.once('close', abortIfResponseClosed)
  try {
    const image = await generateSwarmImage(
      {
        baseUrl: String(settings?.value.swarmBaseUrl ?? ''),
        authToken: settings?.swarmAuthToken ?? ''
      },
      {
        prompt,
        ...(preset.trim() ? { preset } : {}),
        ...(model.trim() ? { model } : {}),
        ...(lora.trim() ? { lora } : {}),
        ...(seedValue !== undefined ? { seed: seedValue } : {}),
        ...(typeof variationSeed === 'number' ? { variationSeed } : {}),
        ...(typeof variationSeedStrength === 'number' ? { variationSeedStrength } : {}),
        signal: abortController.signal
      }
    )
    setResponseHeader(event, 'content-type', image.mimeType)
    setResponseHeader(event, 'content-length', image.bytes.byteLength)
    setResponseHeader(event, 'cache-control', 'no-store, max-age=0')
    return image.bytes
  } catch (caught) {
    if ((caught as Error)?.name === 'AbortError') throw caught
    const error = caught as SwarmProxyError
    recordOperationalError(event, {
      source: 'swarmui',
      operation: 'swarm.generate',
      message: error.message,
      scope: body.scope === 'private' ? 'private' : 'normal',
      status: error.status ?? null,
      requestSent: error.diagnostic?.requestSent ?? null,
      request: {
        settings: {
          baseUrl: settings?.value.swarmBaseUrl ?? '',
          authToken: settings?.swarmAuthToken ?? ''
        },
        body,
        diagnostic: error.diagnostic?.request ?? null
      },
      response: error.diagnostic?.response ?? { detail: error.detail },
      stack: error.stack
    })
    event.context.errorTraceRecorded = true
    throw createError({
      statusCode: error.status && error.status >= 400 ? error.status : 502,
      message: error.message,
      data: { message: error.message, detail: error.detail, diagnostic: error.diagnostic ?? sanitizeSwarmDiagnostic({
        target: 'proxy', operation: '/api/swarm/generate (preparación)', request: body,
        requestSent: false, response: null, message: error.message
      }) }
    })
  } finally {
    event.node.req.off('aborted', abort)
    event.node.res.off('close', abortIfResponseClosed)
  }
})
