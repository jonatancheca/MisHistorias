import type { SwarmCallDiagnostic } from '../../shared/types/index.ts'
import { sanitizeSwarmDiagnostic } from '../../shared/utils/swarmError.ts'

export interface SwarmProxySettings {
  baseUrl: string
  authToken: string
}

export interface SwarmCatalog {
  version: string
  models: string[]
  loras: string[]
  presets: string[]
}

export interface SwarmGenerationRequest {
  prompt: string
  preset?: string
  model?: string
  lora?: string
  seed?: number
  variationSeed?: number
  variationSeedStrength?: number
  signal?: AbortSignal
}

export interface SwarmProxyError extends Error {
  status?: number
  detail?: string
  diagnostic?: SwarmCallDiagnostic
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024

function swarmError(message: string, status?: number, detail?: string): SwarmProxyError {
  return Object.assign(new Error(message), {
    status,
    detail: detail || undefined
  })
}

export function normalizeSwarmBaseUrl(rawBaseUrl: unknown) {
  if (typeof rawBaseUrl !== 'string' || rawBaseUrl.trim() === '') {
    throw swarmError('Falta la URL de SwarmUI')
  }
  let url: URL
  try {
    url = new URL(rawBaseUrl.trim())
  } catch {
    throw swarmError('URL de SwarmUI no válida')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw swarmError('La URL debe usar http o https')
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

function cookieHeader(rawToken: unknown): Record<string, string> {
  if (typeof rawToken !== 'string') return {}
  const token = rawToken.replace(/[\r\n]/g, '').trim()
  return token ? { cookie: `swarm_token=${encodeURIComponent(token)}` } : {}
}

function uniqueStrings(value: unknown) {
  if (!Array.isArray(value)) return []
  const names = value.flatMap((item) => {
    if (typeof item === 'string' && item) return [item]
    if (Array.isArray(item) && typeof item[0] === 'string' && item[0]) return [item[0]]
    return []
  })
  return [...new Set(names)]
    .sort((left, right) => left.localeCompare(right))
}

function connectionError(caught: unknown): SwarmProxyError {
  if ((caught as Error)?.name === 'AbortError') return caught as SwarmProxyError
  return swarmError('No se pudo conectar con SwarmUI. Comprueba la URL y que esté iniciado.')
}

async function postJson(
  baseUrl: string,
  authToken: string,
  route: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
) {
  let response: Response | undefined
  let responseBody: unknown = null
  try {
    response = await fetch(`${baseUrl}/API/${route}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...cookieHeader(authToken)
      },
      body: JSON.stringify(body),
      signal
    })
    const raw = await response.text()
    try { responseBody = JSON.parse(raw) } catch { responseBody = raw }
    const payload = responseBody && typeof responseBody === 'object' && !Array.isArray(responseBody)
      ? responseBody as Record<string, unknown>
      : null
    if (payload?.error_id === 'invalid_session_id') {
      throw Object.assign(swarmError('La sesión de SwarmUI ha caducado'), {
        code: 'ERR_SWARM_INVALID_SESSION'
      })
    }
    if (!response.ok) {
      const message = typeof payload?.error === 'string' ? payload.error
        : typeof payload?.message === 'string' ? payload.message : `SwarmUI respondió ${response.status}`
      throw swarmError(message, response.status, raw)
    }
    if (!payload) throw swarmError('SwarmUI devolvió una respuesta no válida')
    if (typeof payload.error === 'string' && payload.error.trim()) throw swarmError(payload.error.trim())
    return payload
  } catch (caught) {
    if ((caught as Error).name === 'AbortError') throw caught
    const error = response ? caught as SwarmProxyError : connectionError(caught)
    const secrets = [authToken, String(body.session_id ?? '')]
    error.message = String(sanitizeSwarmDiagnostic(error.message, secrets))
    error.detail = error.detail ? String(sanitizeSwarmDiagnostic(error.detail, secrets)) : undefined
    error.diagnostic = sanitizeSwarmDiagnostic({
      target: 'swarm', operation: `/API/${route}`, request: body,
      requestSent: response ? true : null,
      response: response ? { status: response.status, body: responseBody } : null,
      message: error.message
    }, secrets) as SwarmCallDiagnostic
    throw error
  }
}

function createSessionClient(settings: SwarmProxySettings, signal?: AbortSignal) {
  const baseUrl = normalizeSwarmBaseUrl(settings.baseUrl)
  let sessionId = ''
  let version = ''

  const getSession = async () => {
    const payload = await postJson(baseUrl, settings.authToken, 'GetNewSession', {}, signal)
    if (typeof payload.session_id !== 'string' || !payload.session_id) {
      const error = swarmError('SwarmUI no devolvió una sesión válida')
      error.diagnostic = sanitizeSwarmDiagnostic({
        target: 'swarm', operation: '/API/GetNewSession', request: {}, requestSent: true,
        response: { status: 200, body: payload }, message: error.message
      }, [settings.authToken]) as SwarmCallDiagnostic
      throw error
    }
    sessionId = payload.session_id
    version = typeof payload.version === 'string' ? payload.version : ''
  }

  const call = async (route: string, body: Record<string, unknown> = {}) => {
    if (!sessionId) await getSession()
    try {
      return await postJson(
        baseUrl,
        settings.authToken,
        route,
        { ...body, session_id: sessionId },
        signal
      )
    } catch (caught) {
      if ((caught as { code?: string }).code !== 'ERR_SWARM_INVALID_SESSION') throw caught
      await getSession()
      return postJson(
        baseUrl,
        settings.authToken,
        route,
        { ...body, session_id: sessionId },
        signal
      )
    }
  }

  return { baseUrl, call, getVersion: () => version }
}

export async function fetchSwarmCatalog(
  settings: SwarmProxySettings,
  signal?: AbortSignal
): Promise<SwarmCatalog> {
  const client = createSessionClient(settings, signal)
  const params = await client.call('ListT2IParams')
  const user = await client.call('GetMyUserData')
  const models = params.models && typeof params.models === 'object' && !Array.isArray(params.models)
    ? params.models as Record<string, unknown>
    : {}
  const presets = Array.isArray(user.presets)
    ? user.presets.flatMap((preset) => {
        if (!preset || typeof preset !== 'object' || Array.isArray(preset)) return []
        const title = (preset as Record<string, unknown>).title
        return typeof title === 'string' && title ? [title] : []
      })
    : []
  return {
    version: client.getVersion(),
    models: uniqueStrings(models['Stable-Diffusion']),
    loras: uniqueStrings(models.LoRA),
    presets: uniqueStrings(presets)
  }
}

function decodeDataImage(reference: string) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(reference)
  if (!match) throw swarmError('SwarmUI devolvió una imagen embebida no válida')
  if (match[2]!.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4) {
    throw swarmError('La imagen de SwarmUI supera 20 MB', 413)
  }
  const bytes = Buffer.from(match[2]!, 'base64')
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw swarmError('La imagen de SwarmUI supera 20 MB', 413)
  }
  return { bytes, mimeType: match[1]!.toLocaleLowerCase() }
}

async function readLimitedImage(response: Response) {
  if (!response.ok) throw swarmError(`No se pudo descargar la imagen de SwarmUI`, response.status)
  const mimeType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (!mimeType.startsWith('image/')) throw swarmError('SwarmUI no devolvió un archivo de imagen')
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) {
    throw swarmError('La imagen de SwarmUI supera 20 MB', 413)
  }
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw swarmError('La imagen de SwarmUI supera 20 MB', 413)
    return { bytes, mimeType }
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel()
      throw swarmError('La imagen de SwarmUI supera 20 MB', 413)
    }
    chunks.push(value)
  }
  return { bytes: Buffer.concat(chunks, total), mimeType }
}

export async function generateSwarmImage(
  settings: SwarmProxySettings,
  request: SwarmGenerationRequest
) {
  const prompt = request.prompt.trim()
  const preset = request.preset?.trim() ?? ''
  const model = request.model?.trim() ?? ''
  const lora = request.lora?.trim() ?? ''
  const seed = request.seed
  if (!prompt) throw swarmError('Falta el prompt de imagen')
  if (!preset && !model) {
    throw swarmError('Elige un preset o un modelo')
  }
  if ([preset, model, lora].some((value) => value.length > 500 || /[<>]/.test(value))) {
    throw swarmError('Preset, modelo o LoRA no válido')
  }
  if (seed !== undefined && (!Number.isSafeInteger(seed) || seed < 0)) {
    throw swarmError('Semilla no válida')
  }

  if (request.variationSeed !== undefined &&
    (!Number.isInteger(request.variationSeed) || request.variationSeed < 0 || request.variationSeed > 0xffffffff)) {
    throw swarmError('Semilla de variación no válida', 400)
  }
  if (request.variationSeedStrength !== undefined &&
    (!Number.isFinite(request.variationSeedStrength) || request.variationSeedStrength < 0 || request.variationSeedStrength > 1 ||
      (request.variationSeedStrength > 0 && request.variationSeed === undefined))) {
    throw swarmError('Fuerza de variación no válida', 400)
  }
  const generationBody = {
    images: 1,
    donotsave: true,
    prompt: [
      ...(preset ? [`<preset:${preset}>`] : []),
      ...(lora ? [`<lora:${lora}>`] : []),
      prompt
    ].join('\n'),
    ...(model ? { model } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...(request.variationSeed !== undefined ? { variationseed: request.variationSeed } : {}),
    ...(request.variationSeedStrength !== undefined ? { variationseedstrength: request.variationSeedStrength } : {})
  }
  let generated: Record<string, unknown> | undefined
  try {
    const client = createSessionClient(settings, request.signal)
    generated = await client.call('GenerateText2Image', generationBody)
    const reference = Array.isArray(generated.images) ? generated.images[0] : null
    if (typeof reference !== 'string' || !reference) {
      throw swarmError('SwarmUI no devolvió ninguna imagen')
    }
    if (reference.startsWith('data:')) return decodeDataImage(reference)

    const imageUrl = new URL(reference, `${client.baseUrl}/`)
    if (imageUrl.origin !== new URL(client.baseUrl).origin) {
      throw swarmError('SwarmUI devolvió una URL de imagen externa')
    }
    let response: Response | undefined
    let responseBody: unknown = null
    try {
      response = await fetch(imageUrl, {
        headers: { accept: 'image/*', ...cookieHeader(settings.authToken) },
        signal: request.signal
      })
      if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('image/')) {
        const raw = await response.text()
        try { responseBody = JSON.parse(raw) } catch { responseBody = raw }
        throw swarmError('No se pudo descargar la imagen de SwarmUI', response.status)
      }
      return await readLimitedImage(response)
    } catch (caught) {
      if ((caught as Error).name === 'AbortError') throw caught
      const error = response ? caught as SwarmProxyError : connectionError(caught)
      error.diagnostic = sanitizeSwarmDiagnostic({
        target: 'swarm', operation: imageUrl.pathname, request: null,
        requestSent: response ? true : null,
        response: response ? { status: response.status, body: responseBody } : null,
        message: error.message
      }, [settings.authToken]) as SwarmCallDiagnostic
      throw error
    }
  } catch (caught) {
    if ((caught as Error).name === 'AbortError') throw caught
    const error = caught as SwarmProxyError
    error.diagnostic ??= sanitizeSwarmDiagnostic({
      target: generated ? 'swarm' : 'proxy', operation: '/API/GenerateText2Image', request: generationBody,
      requestSent: Boolean(generated), response: generated ? { status: 200, body: generated } : null, message: error.message
    }, [settings.authToken]) as SwarmCallDiagnostic
    if (error.diagnostic.operation !== '/API/GenerateText2Image') {
      error.diagnostic.generation = sanitizeSwarmDiagnostic({
        request: generationBody, requestSent: Boolean(generated)
      }, [settings.authToken]) as NonNullable<SwarmCallDiagnostic['generation']>
    }
    throw error
  }
}
