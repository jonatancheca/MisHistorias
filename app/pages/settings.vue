<script setup lang="ts">
const settings = useSettingsStore()
const characters = useCharactersStore()
const stories = useStoriesStore()
const presets = usePresetsStore()
await settings.load()

const form = reactive({ ...settings.settings })
const models = ref<string[]>([])
const testing = ref(false)
const testMessage = ref<string | null>(null)
const testError = ref<string | null>(null)
const importing = ref(false)
const importMessage = ref<string | null>(null)
const importInput = ref<HTMLInputElement | null>(null)

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
    userName: form.userName.trim() || 'Usuario',
    userColor: form.userColor
  })
}

async function setTheme(theme: 'light' | 'dark') {
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
</script>

<template>
  <div class="mx-auto max-w-3xl p-8">
    <h1 class="mb-6 text-2xl font-bold">Ajustes</h1>

    <section class="mb-8">
      <h2 class="mb-2 text-lg font-semibold">Apariencia</h2>
      <div class="flex gap-2">
        <button
          type="button"
          :class="settings.settings.theme === 'light' ? 'btn-primary' : 'btn-ghost'"
          @click="setTheme('light')"
        >
          Modo claro
        </button>
        <button
          type="button"
          :class="settings.settings.theme === 'dark' ? 'btn-primary' : 'btn-ghost'"
          @click="setTheme('dark')"
        >
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
        <button type="submit" class="btn-primary">Guardar ajustes</button>
      </div>
    </form>

    <section class="mt-10">
      <h2 class="mb-2 text-lg font-semibold">Tu personaje</h2>
      <p class="mb-3 text-sm text-[var(--color-fg-muted)]">
        Nombre y color con los que apareces tú en la historia.
      </p>
      <form class="grid gap-4 sm:grid-cols-2" @submit.prevent="save">
        <div>
          <label class="label" for="userName">Nombre</label>
          <input id="userName" v-model="form.userName" class="field" placeholder="Usuario" />
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
              {{ form.userName || 'Usuario' }}
            </span>
          </div>
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
        <button type="button" class="btn-ghost" @click="doExport">Exportar JSON</button>
        <input ref="importInput" type="file" accept="application/json" class="hidden" @change="onImportFile" />
        <button type="button" class="btn-ghost" :disabled="importing" @click="importInput?.click()">
          {{ importing ? 'Importando…' : 'Importar JSON' }}
        </button>
      </div>
      <p v-if="importMessage" class="mt-2 text-xs text-[var(--color-fg-muted)]">{{ importMessage }}</p>
    </section>
  </div>
</template>
