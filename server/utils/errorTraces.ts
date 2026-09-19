import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import type { ErrorTrace, ErrorTraceSource } from '../../shared/types/index.ts'
import { sanitizeSwarmDiagnostic } from '../../shared/utils/swarmError.ts'
import { accessSessionFromEvent } from './access.ts'
import { getStorage, type DataScope } from './storage.ts'

const MAX_PAYLOAD_BYTES = 256 * 1024
const MAX_TEXT_BYTES = 64 * 1024

export interface OperationalErrorInput {
  source: ErrorTraceSource
  operation: string
  message: string
  scope?: DataScope | null
  status?: number | null
  requestSent?: boolean | null
  request?: unknown
  response?: unknown
  stack?: string | null
}

function dataUrlDescriptor(value: string) {
  const match = /^data:([^;,]+)?((?:;[^,]*)*?),(.*)$/is.exec(value)
  if (!match) return null
  const encoded = match[3] ?? ''
  const base64 = /;base64/i.test(match[2] ?? '')
  return {
    omitted: 'data-url',
    mimeType: match[1] || 'application/octet-stream',
    sizeBytes: base64
      ? Math.max(0, Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0))
      : Buffer.byteLength(encoded)
  }
}

function normalizePayload(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return dataUrlDescriptor(value) ?? value
  if (value === null || typeof value !== 'object') return value ?? null
  if (value instanceof ArrayBuffer) {
    return { omitted: 'binary', type: 'ArrayBuffer', sizeBytes: value.byteLength }
  }
  if (ArrayBuffer.isView(value)) {
    return { omitted: 'binary', type: value.constructor.name, sizeBytes: value.byteLength }
  }
  if (value instanceof Error) {
    return normalizePayload({
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: value.cause
    }, seen)
  }
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map(item => normalizePayload(item, seen))
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, normalizePayload(item, seen)])
  )
}

function truncateUtf8(value: string, maxBytes: number) {
  const bytes = Buffer.from(value)
  if (bytes.byteLength <= maxBytes) return value
  return bytes.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD$/u, '')
}

function preparePayload(value: unknown, secrets: string[] = []) {
  if (value === undefined) return { value: null, truncated: false, serialized: 'null' }
  const normalized = sanitizeSwarmDiagnostic(normalizePayload(value), secrets)
  let serialized: string
  try {
    serialized = JSON.stringify(normalized)
  } catch {
    serialized = JSON.stringify(String(normalized))
  }
  if (Buffer.byteLength(serialized) <= MAX_PAYLOAD_BYTES) {
    return { value: normalized, truncated: false, serialized }
  }
  const preview = truncateUtf8(serialized, Math.floor((MAX_PAYLOAD_BYTES - 1024) / 2))
  const truncatedValue = { truncatedPreview: preview }
  return {
    value: truncatedValue,
    truncated: true,
    serialized: JSON.stringify(truncatedValue)
  }
}

export function readConfiguredOperationalSecrets() {
  const settings = getStorage().readSettings()
  return [settings?.apiKey ?? '', settings?.privateApiKey ?? '', settings?.swarmAuthToken ?? '']
    .filter(Boolean)
}

function sanitizeText(value: string, secrets: string[]) {
  return String(sanitizeSwarmDiagnostic(value, secrets))
}

/** Oculta credenciales reconocibles también al servir trazas antiguas. */
export function sanitizeOperationalErrorTrace(
  trace: ErrorTrace,
  secrets = readConfiguredOperationalSecrets()
): ErrorTrace {
  return {
    ...trace,
    message: sanitizeText(trace.message, secrets),
    request: preparePayload(trace.request, secrets).value,
    response: preparePayload(trace.response, secrets).value,
    stack: trace.stack ? sanitizeText(trace.stack, secrets) : null
  }
}

export function recordOperationalError(event: H3Event | undefined, input: OperationalErrorInput) {
  try {
    const storage = getStorage()
    const secrets = readConfiguredOperationalSecrets()
    const session = event ? accessSessionFromEvent(event) : null
    const request = preparePayload(input.request, secrets)
    const response = preparePayload(input.response, secrets)
    const message = truncateUtf8(
      sanitizeText(input.message || 'Error sin mensaje', secrets),
      MAX_TEXT_BYTES
    )
    const stack = input.stack
      ? truncateUtf8(sanitizeText(input.stack, secrets), MAX_TEXT_BYTES)
      : null
    const trace: ErrorTrace = {
      id: randomUUID(),
      ownerId: session?.identity?.id ?? null,
      ownerEmail: session?.identity?.email ?? null,
      scope: input.scope === 'normal' || input.scope === 'private' ? input.scope : null,
      source: input.source,
      operation: truncateUtf8(input.operation || 'unknown', 512),
      message,
      status: Number.isInteger(input.status) ? Number(input.status) : null,
      requestSent: typeof input.requestSent === 'boolean' ? input.requestSent : null,
      request: request.value,
      response: response.value,
      requestTruncated: request.truncated,
      responseTruncated: response.truncated,
      stack,
      createdAt: Date.now(),
      sizeBytes: Buffer.byteLength([
        request.serialized,
        response.serialized,
        message,
        stack ?? '',
        input.operation,
        session?.identity?.id ?? '',
        session?.identity?.email ?? ''
      ].join(''))
    }
    return storage.writeErrorTrace(trace)
  } catch (caught) {
    console.error('No se pudo guardar la traza de error operativa', caught)
    return null
  }
}
