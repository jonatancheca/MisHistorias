/// <reference types="dom-chromium-ai" />

import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import {
  fetchChromeLlmChat,
  getChromeLlmAvailability,
  normalizeChromeMessages,
  prepareChromeLlm
} from './chromeLlm.ts'

const originalLanguageModel = Object.getOwnPropertyDescriptor(globalThis, 'LanguageModel')

afterEach(() => {
  if (originalLanguageModel) {
    Object.defineProperty(globalThis, 'LanguageModel', originalLanguageModel)
  } else {
    Reflect.deleteProperty(globalThis, 'LanguageModel')
  }
})

function installLanguageModel(api: {
  availability: (options?: LanguageModelCreateCoreOptions) => Promise<Availability>
  create: (options?: LanguageModelCreateOptions) => Promise<Partial<LanguageModel>>
}) {
  Object.defineProperty(globalThis, 'LanguageModel', {
    configurable: true,
    value: api
  })
}

test('compacta todos los mensajes system en la primera posición', () => {
  assert.deepEqual(
    normalizeChromeMessages([
      { role: 'system', content: 'Preparación' },
      { role: 'user', content: 'Hola' },
      { role: 'assistant', content: 'Respuesta anterior' },
      { role: 'system', content: 'Recordatorio final' }
    ]),
    [
      { role: 'system', content: 'Preparación\n\nRecordatorio final' },
      { role: 'user', content: 'Hola' },
      { role: 'assistant', content: 'Respuesta anterior' }
    ]
  )
})

test('declara español al comprobar disponibilidad', async () => {
  let received: LanguageModelCreateCoreOptions | undefined
  installLanguageModel({
    async availability(options) {
      received = options
      return 'available'
    },
    async create() {
      throw new Error('No debe crear sesión')
    }
  })

  assert.equal(await getChromeLlmAvailability(), 'available')
  assert.deepEqual(received?.expectedInputs, [{ type: 'text', languages: ['es'] }])
  assert.deepEqual(received?.expectedOutputs, [{ type: 'text', languages: ['es'] }])
})

test('prepara descarga, informa progreso y destruye sesión', async () => {
  const progress: number[] = []
  let destroyed = false
  installLanguageModel({
    async availability() {
      return 'downloadable'
    },
    async create(options) {
      options?.monitor?.({
        addEventListener(
          _type: keyof CreateMonitorEventMap,
          listener: (this: CreateMonitor, event: ProgressEvent) => unknown
        ) {
          listener.call(this, { loaded: 0.42 } as ProgressEvent)
        }
      } as CreateMonitor)
      return {
        destroy() {
          destroyed = true
          return undefined
        }
      }
    }
  })

  await prepareChromeLlm({ onDownloadProgress: (percent) => progress.push(percent) })
  assert.deepEqual(progress, [42])
  assert.equal(destroyed, true)
})

test('genera con Prompt API, propaga señal y destruye sesión', async () => {
  const controller = new AbortController()
  let promptInput: LanguageModelPrompt | undefined
  let promptSignal: AbortSignal | undefined
  let destroyed = false
  installLanguageModel({
    async availability() {
      return 'available'
    },
    async create(options) {
      assert.equal(options?.signal, controller.signal)
      return {
        async prompt(input, promptOptions) {
          promptInput = input
          promptSignal = promptOptions?.signal
          return 'Respuesta local'
        },
        destroy() {
          destroyed = true
          return undefined
        }
      }
    }
  })

  const result = await fetchChromeLlmChat({
    messages: [
      { role: 'system', content: 'Sistema' },
      { role: 'user', content: 'Acción' }
    ],
    signal: controller.signal
  })

  assert.deepEqual(result, { content: 'Respuesta local', finishReason: null })
  assert.deepEqual(promptInput, [
    { role: 'system', content: 'Sistema' },
    { role: 'user', content: 'Acción' }
  ])
  assert.equal(promptSignal, controller.signal)
  assert.equal(destroyed, true)
})

test('normaliza aborto y exceso de contexto sin fallback', async () => {
  let errorName = 'QuotaExceededError'
  installLanguageModel({
    async availability() {
      return 'available'
    },
    async create() {
      return {
        async prompt() {
          throw Object.assign(new Error('context full'), { name: errorName })
        },
        destroy() {
          return undefined
        }
      }
    }
  })

  await assert.rejects(
    fetchChromeLlmChat({ messages: [{ role: 'user', content: 'Muy largo' }] }),
    /supera el contexto/
  )

  errorName = 'AbortError'
  await assert.rejects(
    fetchChromeLlmChat({ messages: [{ role: 'user', content: 'Cancelar' }] }),
    (caught: unknown) => (caught as Error).name === 'AbortError'
  )
})

test('rechaza navegador incompatible sin crear sesión', async () => {
  let created = false
  installLanguageModel({
    async availability() {
      return 'unavailable'
    },
    async create() {
      created = true
      return {}
    }
  })

  await assert.rejects(
    fetchChromeLlmChat({ messages: [{ role: 'user', content: 'Hola' }] }),
    /no está disponible/
  )
  assert.equal(created, false)
})
