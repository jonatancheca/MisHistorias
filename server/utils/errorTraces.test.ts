import assert from 'node:assert/strict'
import test from 'node:test'
import type { ErrorTrace } from '../../shared/types/index.ts'
import { sanitizeOperationalErrorTrace } from './errorTraces.ts'

test('oculta credenciales reconocibles al servir trazas operativas', () => {
  const trace: ErrorTrace = {
    id: 'trace-1',
    ownerId: null,
    ownerEmail: null,
    scope: 'normal',
    source: 'llm',
    operation: 'llm.chat',
    message: 'Falló configured-secret',
    status: 502,
    requestSent: true,
    request: {
      headers: { authorization: 'Bearer configured-secret' },
      authToken: 'otro-secreto',
      prompt: 'contenido conservado',
      reflected: 'configured-secret',
      image: 'data:image/png;base64,AAAA'
    },
    response: { apiKey: 'otro-secreto', detail: 'configured-secret rechazado' },
    requestTruncated: false,
    responseTruncated: false,
    stack: 'Error: configured-secret',
    createdAt: 1,
    sizeBytes: 100
  }

  const sanitized = sanitizeOperationalErrorTrace(trace, ['configured-secret'])
  const serialized = JSON.stringify(sanitized)

  assert.doesNotMatch(serialized, /configured-secret|otro-secreto/)
  assert.match(serialized, /contenido conservado/)
  assert.match(serialized, /\[REDACTED\]/)
  assert.deepEqual((sanitized.request as Record<string, unknown>).image, {
    omitted: 'data-url',
    mimeType: 'image/png',
    sizeBytes: 3
  })
})
