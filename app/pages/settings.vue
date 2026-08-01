<script setup lang="ts">
const settings = useSettingsStore()
const characters = useCharactersStore()
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
let privateClickCount = 0
let privateClickTimer: ReturnType<typeof setTimeout> | null = null

async function testConnection() {
  testing.value = true
  testError.value = null
  testMessage.value = null
  try {
    const result = await $fetch<{ models: string[] }>('/api/llm/models', {
      method: 'POST',
      body: { baseUrl: form.baseUrl, apiKey: form.apiKey }
    })
    models.value = result.models
    testMessage.value = `${result.models.length} modelos disponibles`
    if (!form.model && result.models[0]) form.model = result.models[0]
  } catch (caught) {
    const detail = caught as { statusMessage?: string; message?: string }
    testError.value = detail.statusMessage || detail.message || 'No se pudo conectar'
  } finally {
    testing.value = false
  }
}

async function save() {
  await settings.save({
    baseUrl: form.baseUrl.trim(),
    apiKey: form.apiKey.trim(),
    model: form.model,
    temperature: Number(form.temperature),
    maxTokens: Number(form.maxTokens),
    historyBudget: Number(form.historyBudget),
    responseSpeed: form.responseSpeed,
    userName: form.userName.trim() || 'Protagonista',
    userColor: form.userColor,
    protagonistPreferences: form.protagonistPreferences.trim()
  })
}

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
})
</script>

<template>
  <div class="mx-auto max-w-3xl p-8">
    <h1 class="mb-6 text-2xl font-bold">Ajustes</h1>

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

    <form class="grid gap-5" @submit.prevent="save">
      <div class="card">
        <label class="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            class="mt-1 h-4 w-4 accent-[var(--color-brand-500)]"
            :checked="settings.settings.mockMode"
            @change="setMockMode(($event.target as HTMLInputElement).checked)"
          />
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
          <input id="baseUrl" v-model="form.baseUrl" class="field" placeholder="http://localhost:1234" />
          <button type="button" class="btn-ghost shrink-0" :disabled="testing" @click="testConnection">
            {{ testing ? 'Probando…' : 'Probar conexión' }}
          </button>
        </div>
        <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
          Sin `/v1` al final. Solo se permiten direcciones locales o de red privada.
        </p>
        <p v-if="testMessage" class="mt-1 text-xs text-brand-600">{{ testMessage }}</p>
        <p v-if="testError" class="mt-1 text-xs text-red-500">{{ testError }}</p>
      </div>

      <div>
        <label class="label" for="apiKey">Token de acceso (opcional)</label>
        <input
          id="apiKey"
          v-model="form.apiKey"
          type="password"
          autocomplete="off"
          class="field"
          placeholder="Solo si LMStudio pide API key"
        />
        <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
          Se envía como <code>Authorization: Bearer</code>. Se guarda en este navegador sin cifrar.
        </p>
      </div>

      <div>
        <label class="label" for="model">Modelo</label>
        <select v-if="models.length" id="model" v-model="form.model" class="field">
          <option v-for="model in models" :key="model" :value="model">{{ model }}</option>
        </select>
        <input v-else id="model" v-model="form.model" class="field" placeholder="nombre-del-modelo" />
      </div>

      <div class="grid gap-4 sm:grid-cols-3">
        <div>
          <label class="label" for="temperature">Temperatura</label>
          <input
            id="temperature"
            v-model.number="form.temperature"
            type="number"
            step="0.1"
            min="0"
            max="2"
            class="field"
          />
        </div>
        <div>
          <label class="label" for="maxTokens">Máx. tokens</label>
          <input id="maxTokens" v-model.number="form.maxTokens" type="number" min="64" class="field" />
        </div>
        <div>
          <label class="label" for="historyBudget">Historial (caracteres)</label>
          <input
            id="historyBudget"
            v-model.number="form.historyBudget"
            type="number"
            min="1000"
            step="1000"
            class="field"
          />
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

      <div>
        <button type="submit" class="btn-primary">Guardar ajustes</button>
      </div>
    </form>

    <section class="mt-10">
      <h2 class="mb-2 text-lg font-semibold">Protagonista</h2>
      <p class="mb-3 text-sm text-[var(--color-fg-muted)]">
        Nombre, color y preferencias con los que apareces en todas las historias.
      </p>
      <form class="grid gap-4 sm:grid-cols-2" @submit.prevent="save">
        <div>
          <label class="label" for="userName">Nombre</label>
          <input id="userName" v-model="form.userName" class="field" placeholder="Protagonista" />
        </div>
        <div>
          <label class="label" for="userColor">Color</label>
          <div class="flex items-center gap-3">
            <input
              id="userColor"
              v-model="form.userColor"
              type="color"
              class="h-9 w-14 cursor-pointer rounded border border-[var(--color-border-soft)] bg-transparent"
            />
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
            class="field min-h-28"
            placeholder="Personalidad, límites, objetivos o forma de actuar del protagonista."
          />
        </div>
        <div class="sm:col-span-2">
          <button type="submit" class="btn-primary">Guardar</button>
        </div>
      </form>
    </section>

    <section class="mt-10">
      <h2 class="mb-2 text-lg font-semibold">Datos</h2>
      <p class="mb-3 text-sm text-[var(--color-fg-muted)]">
        Todo se guarda en el navegador (IndexedDB). Exporta para hacer copia o mover a otro equipo.
      </p>
      <div class="flex flex-wrap gap-2">
        <div class="flex shrink-0 items-center gap-1">
          <button type="button" class="btn-ghost" @click="doExport">Exportar JSON</button>
          <button
            type="button"
            class="h-9 w-9 opacity-0"
            aria-label="Activar modo privado"
            :disabled="privacy.switching"
            @click="onPrivateTrigger"
          />
        </div>
        <input ref="importInput" type="file" accept="application/json" class="hidden" @change="onImportFile" />
        <button type="button" class="btn-ghost" :disabled="importing" @click="importInput?.click()">
          {{ importing ? 'Importando…' : 'Importar JSON' }}
        </button>
      </div>

      <p v-if="importMessage" class="mt-2 text-xs text-[var(--color-fg-muted)]">{{ importMessage }}</p>
    </section>
  </div>
</template>
