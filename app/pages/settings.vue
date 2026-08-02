<script setup lang="ts">
import type { AppSettings } from '#shared/types'
import { fetchLlmModels } from '~/lib/llm'

const settings = useSettingsStore()
const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const stories = useStoriesStore()
const presets = usePresetsStore()
const privacy = usePrivacyStore()
await settings.load()

const form = reactive({ ...settings.settings })
const models = ref<string[]>([])
const testing = ref(false)
const testMessage = ref<string | null>(null)
const testError = ref<string | null>(null)
const importing = ref(false)
const importMessage = ref<string | null>(null)
const importInput = ref<HTMLInputElement | null>(null)
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const saveError = ref<string | null>(null)
let saveTimer: ReturnType<typeof setTimeout> | null = null
let savePending = false
let saveRevision = 0
let saveQueue: Promise<void> = Promise.resolve()
let apiKeyDirty = false
let privateClickCount = 0
let privateClickTimer: ReturnType<typeof setTimeout> | null = null

async function testConnection() {
  testing.value = true
  testError.value = null
  testMessage.value = null
  try {
    await flushSave()
    const availableModels = await fetchLlmModels()
    models.value = availableModels
    testMessage.value = `${availableModels.length} modelos disponibles`
    if (!form.model && availableModels[0]) form.model = availableModels[0]
  } catch (caught) {
    const detail = caught as { statusMessage?: string; message?: string }
    testError.value = detail.statusMessage || detail.message || 'No se pudo conectar'
  } finally {
    testing.value = false
  }
}

function settingsPatch() {
  const patch: Partial<AppSettings> = {
    baseUrl: form.baseUrl.trim(),
    model: form.model,
    temperature: Number(form.temperature),
    maxTokens: Number(form.maxTokens),
    historyBudget: Number(form.historyBudget),
    responseSpeed: form.responseSpeed,
    userName: form.userName.trim() || 'Protagonista',
    userColor: form.userColor,
    protagonistPreferences: form.protagonistPreferences.trim()
  }
  if (apiKeyDirty) patch.apiKey = form.apiKey.trim()
  return patch
}

function enqueueSave(revision: number) {
  const patch = settingsPatch()
  const run = async () => {
    saveStatus.value = 'saving'
    saveError.value = null
    try {
      await settings.save(patch)
      if (revision === saveRevision) {
        if ('apiKey' in patch) apiKeyDirty = false
        form.apiKeyConfigured = settings.settings.apiKeyConfigured
        saveStatus.value = 'saved'
      }
    } catch (caught) {
      if (revision === saveRevision) {
        saveStatus.value = 'error'
        saveError.value = (caught as Error).message || 'No se pudieron guardar los ajustes.'
      }
    }
  }
  saveQueue = saveQueue.then(run, run)
  return saveQueue
}

function onApiKeyInput() {
  apiKeyDirty = true
}

function clearApiKey() {
  form.apiKey = ''
  apiKeyDirty = true
  scheduleSave()
}

function scheduleSave() {
  saveRevision += 1
  savePending = true
  if (saveTimer) clearTimeout(saveTimer)
  const revision = saveRevision
  saveTimer = setTimeout(() => {
    saveTimer = null
    savePending = false
    void enqueueSave(revision)
  }, 500)
}

async function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (savePending) {
    savePending = false
    await enqueueSave(saveRevision)
  } else {
    await saveQueue
  }
}

watch(
  () => [
    form.baseUrl,
    form.apiKey,
    form.model,
    form.temperature,
    form.maxTokens,
    form.historyBudget,
    form.responseSpeed,
    form.userName,
    form.userColor,
    form.protagonistPreferences
  ],
  scheduleSave
)

async function setTheme(theme: 'system' | 'light' | 'dark') {
  form.theme = theme
  await settings.save({ theme })
}

async function setMockMode(mockMode: boolean) {
  form.mockMode = mockMode
  await settings.save({ mockMode })
}

async function doExport() {
  const { exportBundle, downloadBundle } = await import('~/lib/transfer')
  downloadBundle(await exportBundle())
}

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importing.value = true
  importMessage.value = null
  try {
    const { importBundle } = await import('~/lib/transfer')
    await importBundle(await file.text())
    await Promise.all([
      characters.load(true),
      backgrounds.load(true),
      stories.load(true),
      presets.load(true)
    ])
    importMessage.value = 'Importación completada'
  } catch (caught) {
    importMessage.value = (caught as Error).message || 'Fallo al importar'
  } finally {
    importing.value = false
    input.value = ''
  }
}

async function onPrivateTrigger() {
  if (privacy.isPrivate) return

  privateClickCount += 1
  if (privateClickTimer) clearTimeout(privateClickTimer)

  if (privateClickCount === 3) {
    privateClickCount = 0
    privateClickTimer = null
    await privacy.activate()
    return
  }

  privateClickTimer = setTimeout(() => {
    privateClickCount = 0
    privateClickTimer = null
  }, 1000)
}

onBeforeUnmount(() => {
  if (privateClickTimer) clearTimeout(privateClickTimer)
  void flushSave()
})

onBeforeRouteLeave(async () => {
  await flushSave()
})
</script>

<template>
  <div class="mx-auto max-w-3xl p-8">
    <h1 class="mb-6 text-2xl font-bold">Ajustes</h1>
    <p class="-mt-4 mb-6 min-h-5 text-xs text-[var(--color-fg-muted)]" aria-live="polite">
      <span v-if="saveStatus === 'saving'">Guardando…</span>
      <span v-else-if="saveStatus === 'saved'">Guardado</span>
      <span v-else-if="saveStatus === 'error'" class="text-red-500">
        {{ saveError || 'Error al guardar' }}
      </span>
    </p>

    <section class="mb-8">
      <h2 class="mb-2 text-lg font-semibold">Apariencia</h2>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          :class="settings.settings.theme === 'system' ? 'btn-primary' : 'btn-ghost'"
          @click="setTheme('system')"
        >
          <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="13" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
          Sistema
        </button>
        <button
          type="button"
          :class="settings.settings.theme === 'light' ? 'btn-primary' : 'btn-ghost'"
          @click="setTheme('light')"
        >
          <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
          </svg>
          Modo claro
        </button>
        <button
          type="button"
          :class="settings.settings.theme === 'dark' ? 'btn-primary' : 'btn-ghost'"
          @click="setTheme('dark')"
        >
          <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
          </svg>
          Modo oscuro
        </button>
      </div>
    </section>

    <section class="grid gap-5">
      <div class="card">
        <label class="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            autocomplete="off"
            class="mt-1 h-4 w-4 accent-[var(--color-brand-500)]"
            :checked="settings.settings.mockMode"
            @change="setMockMode(($event.target as HTMLInputElement).checked)"
          >
          <span>
            <span class="block text-sm font-semibold">Modo prueba (sin LLM)</span>
            <span class="block text-xs text-[var(--color-fg-muted)]">
              Las historias responden texto aleatorio con el formato de siempre. No se llama a
              LMStudio.
            </span>
          </span>
        </label>
      </div>

      <div>
        <label class="label" for="baseUrl">URL del servidor (LMStudio)</label>
        <div class="flex gap-2">
          <input
            id="baseUrl"
            v-model="form.baseUrl"
            autocomplete="off"
            class="field min-w-0 flex-1"
            placeholder="http://localhost:1234"
          >
          <button
            type="button"
            class="btn-ghost flex h-10 w-10 shrink-0 items-center justify-center gap-2 px-0 sm:w-auto sm:px-3"
            :aria-label="testing ? 'Probando conexión' : 'Probar conexión'"
            :title="testing ? 'Probando conexión' : 'Probar conexión'"
            :disabled="testing"
            @click="testConnection"
          >
            <svg
              aria-hidden="true"
              class="h-4 w-4"
              :class="{ 'animate-pulse': testing }"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M8 4v5M16 4v5M7 9h10v1a5 5 0 0 1-10 0V9Zm5 6v5" />
            </svg>
            <span class="hidden sm:inline">{{ testing ? 'Probando…' : 'Probar conexión' }}</span>
          </button>
        </div>
        <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
          Sin `/v1` al final. El servidor de Mis Historias conecta con LM Studio.
        </p>
        <p v-if="testMessage" class="mt-1 text-xs text-brand-600">{{ testMessage }}</p>
        <p v-if="testError" class="mt-1 text-xs text-red-500">{{ testError }}</p>
      </div>

      <div>
        <label class="label" for="apiKey">Token de acceso (opcional)</label>
        <div class="flex gap-2">
          <input
            id="apiKey"
            v-model="form.apiKey"
            type="password"
            autocomplete="off"
            class="field"
            :placeholder="form.apiKeyConfigured ? 'Token configurado; escribe para cambiarlo' : 'Solo si LMStudio pide API key'"
            @input="onApiKeyInput"
          >
          <button
            v-if="form.apiKeyConfigured"
            type="button"
            class="btn-ghost shrink-0"
            @click="clearApiKey"
          >
            Quitar token
          </button>
        </div>
        <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
          Se guarda en SQLite sin cifrar y nunca se devuelve al navegador.
        </p>
      </div>

      <div>
        <label class="label" for="model">Modelo</label>
        <select v-if="models.length" id="model" v-model="form.model" class="field">
          <option v-for="model in models" :key="model" :value="model">{{ model }}</option>
        </select>
        <input
          v-else
          id="model"
          v-model="form.model"
          autocomplete="off"
          class="field"
          placeholder="nombre-del-modelo"
        >
      </div>

      <div class="grid gap-4 sm:grid-cols-3">
        <div>
          <label class="label" for="temperature">Temperatura</label>
          <input
            id="temperature"
            v-model.number="form.temperature"
            type="number"
            autocomplete="off"
            step="0.1"
            min="0"
            max="2"
            class="field"
          >
        </div>
        <div>
          <label class="label" for="maxTokens">Máx. tokens</label>
          <input
            id="maxTokens"
            v-model.number="form.maxTokens"
            type="number"
            autocomplete="off"
            min="64"
            class="field"
          >
        </div>
        <div>
          <label class="label" for="historyBudget">Historial (caracteres)</label>
          <input
            id="historyBudget"
            v-model.number="form.historyBudget"
            type="number"
            autocomplete="off"
            min="1000"
            step="1000"
            class="field"
          >
        </div>
      </div>

      <div>
        <label class="label" for="responseSpeed">Velocidad de escritura</label>
        <select id="responseSpeed" v-model="form.responseSpeed" class="field">
          <option value="slow">Lenta</option>
          <option value="medium">Media</option>
          <option value="high">Alta</option>
          <option value="instant">Inmediata</option>
        </select>
        <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
          Controla cómo aparece la respuesta una vez recibida del modelo.
        </p>
      </div>

    </section>

    <section class="mt-10">
      <h2 class="mb-2 text-lg font-semibold">Protagonista</h2>
      <p class="mb-3 text-sm text-[var(--color-fg-muted)]">
        Nombre, color y preferencias con los que apareces en todas las historias.
      </p>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="userName">Nombre</label>
          <input
            id="userName"
            v-model="form.userName"
            autocomplete="off"
            class="field"
            placeholder="Protagonista"
          >
        </div>
        <div>
          <label class="label" for="userColor">Color</label>
          <div class="flex items-center gap-3">
            <input
            id="userColor"
            v-model="form.userColor"
            type="color"
            autocomplete="off"
            class="h-9 w-14 cursor-pointer rounded border border-[var(--color-border-soft)] bg-transparent"
            >
            <span class="text-sm font-semibold" :style="{ color: form.userColor }">
              {{ form.userName || 'Protagonista' }}
            </span>
          </div>
        </div>
        <div class="sm:col-span-2">
          <label class="label" for="protagonistPreferences">Preferencias globales</label>
          <textarea
            id="protagonistPreferences"
            v-model="form.protagonistPreferences"
            autocomplete="off"
            class="field min-h-28"
            placeholder="Personalidad, límites, objetivos o forma de actuar del protagonista."
          />
        </div>
      </div>
    </section>

    <section class="mt-10">
      <h2 class="mb-2 text-lg font-semibold">Datos</h2>
      <p class="mb-3 text-sm text-[var(--color-fg-muted)]">
        Todo se guarda en SQLite y se comparte con los equipos que usan este servidor.
      </p>
      <div class="flex flex-wrap gap-2">
        <div class="flex shrink-0 items-center gap-1">
          <button type="button" class="btn-ghost" @click="doExport">Exportar JSON</button>
        </div>
        <input ref="importInput" type="file" accept="application/json" autocomplete="off" class="hidden" @change="onImportFile" >
        <button type="button" class="btn-ghost" :disabled="importing" @click="importInput?.click()">
          {{ importing ? 'Importando…' : 'Importar JSON' }}
        </button>
        <NuxtLink to="/dev/test-data" class="btn-ghost">Datos de prueba</NuxtLink>
        <button
          type="button"
          class="h-10 w-12 opacity-0"
          aria-label="Activar modo privado"
          :disabled="privacy.switching"
          @click="onPrivateTrigger"
        />
      </div>

      <p v-if="importMessage" class="mt-2 text-xs text-[var(--color-fg-muted)]">{{ importMessage }}</p>
    </section>
  </div>
</template>
