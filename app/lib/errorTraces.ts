import type {
  ErrorTraceListResponse,
  ErrorTraceSource
} from '#shared/types'
import { getActiveDataScope } from './db.ts'

export interface ErrorTraceFilters {
  source?: ErrorTraceSource
  owner?: string
  scope?: 'normal' | 'private'
  limit?: number
  offset?: number
}

export interface ClientErrorTraceInput {
  source: 'llm' | 'client'
  operation: string
  message: string
  scope?: 'normal' | 'private'
  status?: number | null
  requestSent?: boolean | null
  request?: unknown
  response?: unknown
  stack?: string | null
}

export function listErrorTraces(filters: ErrorTraceFilters = {}) {
  return $fetch<ErrorTraceListResponse>('/api/error-traces', { query: filters })
}

export function clearErrorTraces() {
  return $fetch<{ deleted: number }>('/api/error-traces', { method: 'DELETE' })
}

export async function reportClientErrorTrace(input: ClientErrorTraceInput) {
  try {
    await $fetch('/api/error-traces/report', {
      method: 'POST',
      body: {
        ...input,
        scope: input.scope ?? getActiveDataScope()
      }
    })
  } catch {
    // El registro es diagnóstico y nunca debe sustituir el error original.
  }
}
