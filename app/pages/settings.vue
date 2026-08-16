<script setup lang="ts">
import type { AppSettings, DatabaseBackup } from '#shared/types'
import { fetchLlmModels } from '~/lib/llm'
import {
  getChromeLlmAvailability,
  prepareChromeLlm,
  type ChromeLlmAvailability
} from '~/lib/chromeLlm'
import {
  createDatabaseBackup,
  listDatabaseBackups,
  readApiKey,
  restoreDatabaseBackup
} from '~/lib/db'

const settings = useSettingsStore()
const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const stories = useStoriesStore()
const presets = usePresetsStore()
const privacy = usePrivacyStore()
const confirmDialog = useConfirmStore()
await settings.load()

const form = reactive({ ...settings.settings })
if (privacy.isPrivate) {
  form.userName = settings.settings.privateUserName ?? settings.settings.userName
  form.protagonistPreferences =
    settings.settings.privateProtagonistPreferences ?? settings.settings.protagonistPreferences
}
const models = ref<string[]>([])
const testing = ref(false)
const testMessage = ref<string | null>(null)
const testError = ref<string | null>(null)
const importing = ref(false)
const importMessage = ref<string | null>(null)
const importInput = ref<HTMLInputElement | null>(null)
const backups = ref<DatabaseBackup[]>([])
const backupsLoading = ref(false)
const backupAction = ref<string | null>(null)
const backupMessage = ref<string | null>(null)
const backupError = ref<string | null>(null)
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const saveError = ref<string | null>(null)
const apiKeyVisible = ref(false)
const apiKeyLoading = ref(false)
const apiKeyError = ref<string | null>(null)
const chromeLlmEnabled = ref(settings.activeUseChromeLlm)
const chromeLlmAvailability = ref<ChromeLlmAvailability | 'checking' | 'error'>('checking')
const chromeLlmPreparing = ref(false)
const chromeLlmProgress = ref<number | null>(null)
const chromeLlmError = ref<string | null>(null)
let saveTimer: ReturnType<typeof setTimeout> | null = null
let savedTimer: ReturnType<typeof setTimeout> | null = null
let savePending = false
let saveRevision = 0
let saveQueue: Promise<void> = Promise.resolve()
let apiKeyDirty = false
let revealingApiKey = false
let privateUserNameDirty: boolean = false
let privateProtagonistPreferencesDirty: boolean = false
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
    userColor: form.userColor
  }
  if (privacy.isPrivate) {
    if (privateUserNameDirty) patch.privateUserName = form.userName.trim() || 'Protagonista'
    if (privateProtagonistPreferencesDirty) {
      patch.privateProtagonistPreferences = form.protagonistPreferences.trim()
    }
  } else {
    patch.userName = form.userName.trim() || 'Protagonista'
    patch.protagonistPreferences = form.protagonistPreferences.trim()
  }
  if (apiKeyDirty) patch.apiKey = form.apiKey.trim()
  return patch
}

function enqueueSave(revision: number) {
  const patch = settingsPatch()
  const run = async () => {
    if (savedTimer) {
      clearTimeout(savedTimer)
      savedTimer = null
    }
    saveStatus.value = 'saving'
    saveError.value = null
    try {
      await settings.save(patch)
      if (revision === saveRevision) {
        if ('apiKey' in patch) apiKeyDirty = false
        if ('privateUserName' in patch) privateUserNameDirty = false
        if ('privateProtagonistPreferences' in patch) privateProtagonistPreferencesDirty = false
        form.apiKeyConfigured = settings.settings.apiKeyConfigured
        saveStatus.value = 'saved'
        savedTimer = setTimeout(() => {
          savedTimer = null
          if (saveStatus.value === 'saved') saveStatus.value = 'idle'
        }, 2000)
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
  apiKeyError.value = null
}

function markPrivateUserNameDirty() {
  privateUserNameDirty = true
}

function markPrivateProtagonistPreferencesDirty() {
  privateProtagonistPreferencesDirty = true
}

function clearApiKey() {
  form.apiKey = ''
  apiKeyVisible.value = false
  apiKeyError.value = null
  apiKeyDirty = true
  scheduleSave()
}

async function toggleApiKeyVisibility() {
  if (apiKeyVisible.value) {
    apiKeyVisible.value = false
    return
  }
  apiKeyError.value = null
  if (!form.apiKey && form.apiKeyConfigured) {
    apiKeyLoading.value = true
    try {
      const result = await readApiKey()
      revealingApiKey = true
      form.apiKey = result.apiKey
      await nextTick()
      apiKeyDirty = false
    } catch (caught) {
      apiKeyError.value = (caught as Error).message || 'No se pudo mostrar el token.'
      return
    } finally {
      revealingApiKey = false
      apiKeyLoading.value = false
    }
  }
  apiKeyVisible.value = true
}

function scheduleSave() {
  if (revealingApiKey) return
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

async function refreshChromeLlmAvailability() {
  chromeLlmAvailability.value = 'checking'
  chromeLlmError.value = null
  try {
    chromeLlmAvailability.value = await getChromeLlmAvailability()
  } catch (caught) {
    chromeLlmAvailability.value = 'error'
    chromeLlmError.value = (caught as Error).message || 'No se pudo comprobar la IA local de Chrome.'
  }
}

async function setChromeLlmEnabled(enabled: boolean) {
  if (chromeLlmPreparing.value) return
  chromeLlmError.value = null
  chromeLlmEnabled.value = enabled

  const patch = privacy.isPrivate
    ? { privateUseChromeLlm: enabled }
    : { useChromeLlm: enabled }

  if (!enabled) {
    try {
      await settings.save(patch)
      chromeLlmEnabled.value = false
    } catch (caught) {
      chromeLlmEnabled.value = settings.activeUseChromeLlm
      chromeLlmError.value = (caught as Error).message || 'No se pudo guardar el ajuste.'
    }
    return
  }

  chromeLlmPreparing.value = true
  chromeLlmProgress.value = null
  try {
    const availability = await getChromeLlmAvailability()
    chromeLlmAvailability.value = availability
    if (availability === 'unavailable') {
      throw new Error('La IA local de Chrome no está disponible en este navegador o equipo.')
    }
    await prepareChromeLlm({
      onDownloadProgress(percent) {
        chromeLlmProgress.value = percent
        chromeLlmAvailability.value = percent >= 100 ? 'available' : 'downloading'
      }
    })
    await settings.save(patch)
    chromeLlmEnabled.value = true
    chromeLlmAvailability.value = 'available'
  } catch (caught) {
    chromeLlmEnabled.value = settings.activeUseChromeLlm
    chromeLlmError.value = (caught as Error).message || 'No se pudo preparar la IA local de Chrome.'
  } finally {
    chromeLlmPreparing.value = false
  }
}

function backupErrorMessage(caught: unknown, fallback: string) {
  const detail = caught as {
    data?: { statusMessage?: string }
    statusMessage?: string
    message?: string
  }
  return detail.data?.statusMessage || detail.statusMessage || detail.message || fallback
}

async function loadBackups() {
  backupsLoading.value = true
  backupError.value = null
  try {
    backups.value = await listDatabaseBackups()
  } catch (caught) {
    backupError.value = backupErrorMessage(caught, 'No se pudieron cargar los backups.')
  } finally {
    backupsLoading.value = false
  }
}

async function createBackup() {
  backupAction.value = 'create'
  backupMessage.value = null
  backupError.value = null
  try {
    await flushSave()
    const created = await createDatabaseBackup()
    await loadBackups()
    backupMessage.value = `Backup creado: ${created.name}`
  } catch (caught) {
    backupError.value = backupErrorMessage(caught, 'No se pudo crear el backup.')
  } finally {
    backupAction.value = null
  }
}

async function restoreBackup(backup: DatabaseBackup) {
  const accepted = await confirmDialog.ask({
    title: 'Restaurar backup',
    message: `Restaurar “${backup.name}” reemplazará toda la base SQLite actual: colección normal, colección privada y ajustes. Antes se creará otro backup de seguridad.`,
    confirmLabel: 'Restaurar'
  })
  if (!accepted) return

  backupAction.value = `restore:${backup.name}`
  backupMessage.value = null
  backupError.value = null
  try {
    await flushSave()
    await restoreDatabaseBackup(backup.name)
    sessionStorage.setItem('mishistorias-backup-message', `Backup restaurado: ${backup.name}`)
    window.location.reload()
  } catch (caught) {
    backupError.value = backupErrorMessage(caught, 'No se pudo restaurar el backup.')
    backupAction.value = null
  }
}

function backupKindLabel(kind: DatabaseBackup['kind']) {
  if (kind === 'manual') return 'Manual'
  if (kind === 'before-restore') return 'Antes de restaurar'
  return 'Antes de migrar'
}

function formatBackupDate(value: string) {
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function formatBackupSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

await loadBackups()

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
  if (savedTimer) clearTimeout(savedTimer)
  void flushSave()
})

onMounted(() => {
  void refreshChromeLlmAvailability()
  const message = sessionStorage.getItem('mishistorias-backup-message')
  if (!message) return
  sessionStorage.removeItem('mishistorias-backup-message')
  backupMessage.value = message
})

onBeforeRouteLeave(async () => {
  await flushSave()
})
</script>

<template>
  <div class="page-shell">
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

      <div class="card">
        <label class="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            autocomplete="off"
            class="mt-1 h-4 w-4 accent-[var(--color-brand-500)]"
            :checked="chromeLlmEnabled"
            :disabled="chromeLlmPreparing"
            @change="setChromeLlmEnabled(($event.target as HTMLInputElement).checked)"
          >
          <span class="min-w-0">
            <span class="block text-sm font-semibold">Usar IA local de Chrome</span>
            <span class="block text-xs text-[var(--color-fg-muted)]">
              <template v-if="privacy.isPrivate">
                Ajuste exclusivo del modo privado. Hereda el valor normal hasta cambiarlo.
              </template>
              <template v-else>
                Usa la Prompt API y Gemini Nano dentro del navegador. No envía la historia a LMStudio.
              </template>
            </span>
            <span class="mt-1 block text-xs" aria-live="polite">
              <template v-if="chromeLlmPreparing">
                Preparando modelo<span v-if="chromeLlmProgress !== null">: {{ chromeLlmProgress }}%</span>…
              </template>
              <template v-else-if="chromeLlmAvailability === 'checking'">Comprobando compatibilidad…</template>
              <template v-else-if="chromeLlmAvailability === 'available'">Modelo local preparado.</template>
              <template v-else-if="chromeLlmAvailability === 'downloadable'">Compatible; falta descargar el modelo.</template>
              <template v-else-if="chromeLlmAvailability === 'downloading'">Descarga del modelo en curso.</template>
              <template v-else-if="chromeLlmAvailability === 'unavailable'">No disponible en este navegador o equipo.</template>
            </span>
            <span v-if="chromeLlmError" class="mt-1 block text-xs text-red-500" role="alert">
              {{ chromeLlmError }}
            </span>
          </span>
        </label>
      </div>

      <p v-if="chromeLlmEnabled" class="text-xs text-[var(--color-fg-muted)]">
        URL, token, modelo, temperatura y máximo de tokens solo se aplican a LMStudio y quedan
        guardados para cuando desactives Chrome.
      </p>

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
            :type="apiKeyVisible ? 'text' : 'password'"
            autocomplete="off"
            class="field min-w-0 flex-1"
            :placeholder="form.apiKeyConfigured ? 'Token configurado; escribe para cambiarlo' : 'Solo si LMStudio pide API key'"
            @input="onApiKeyInput"
          >
          <button
            v-if="form.apiKeyConfigured || form.apiKey"
            type="button"
            class="btn-ghost flex h-10 w-10 shrink-0 items-center justify-center px-0"
            :disabled="apiKeyLoading"
            :aria-label="apiKeyVisible ? 'Ocultar token' : 'Mostrar token'"
            :title="apiKeyVisible ? 'Ocultar token' : 'Mostrar token'"
            @click="toggleApiKeyVisibility"
          >
            <svg v-if="apiKeyVisible" aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.7 10.7 0 0 1 12 4c5.5 0 9 5.5 9 5.5a16.8 16.8 0 0 1-2.1 2.7M6.6 6.6C4.3 8 3 10 3 10s3.5 5.5 9 5.5c1 0 2-.2 2.8-.5" />
            </svg>
            <svg v-else aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
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
          Se guarda en SQLite sin cifrar. Solo se muestra en este navegador al pulsar el botón.
        </p>
        <p v-if="apiKeyError" class="mt-1 text-xs text-red-500" role="alert">{{ apiKeyError }}</p>
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
        <template v-if="privacy.isPrivate">
          Nombre y preferencias exclusivos del modo privado. El color sigue compartido.
        </template>
        <template v-else>Nombre, color y preferencias con los que apareces en todas las historias.</template>
      </p>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="userName">{{ privacy.isPrivate ? 'Nombre privado' : 'Nombre' }}</label>
          <input
            id="userName"
            v-model="form.userName"
            autocomplete="off"
            class="field"
            placeholder="Protagonista"
            @input="markPrivateUserNameDirty"
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
          <label class="label" for="protagonistPreferences">
            {{ privacy.isPrivate ? 'Preferencias globales privadas' : 'Preferencias globales' }}
          </label>
          <textarea
            id="protagonistPreferences"
            v-model="form.protagonistPreferences"
            autocomplete="off"
            class="field min-h-28"
            placeholder="Personalidad, límites, objetivos o forma de actuar del protagonista."
            @input="markPrivateProtagonistPreferencesDirty"
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
        <div class="flex shrink-0 flex-col items-center gap-1">
          <button type="button" class="btn-ghost" @click="doExport">Exportar JSON</button>
          <button
            type="button"
            class="h-10 w-12 opacity-0"
            aria-label="Activar modo privado"
            :disabled="privacy.switching"
            @click="onPrivateTrigger"
          />
        </div>
        <input ref="importInput" type="file" accept="application/json" autocomplete="off" class="hidden" @change="onImportFile" >
        <button type="button" class="btn-ghost" :disabled="importing" @click="importInput?.click()">
          {{ importing ? 'Importando…' : 'Importar JSON' }}
        </button>
        <NuxtLink to="/dev/test-data" class="btn-ghost">Datos de prueba</NuxtLink>
      </div>

      <p v-if="importMessage" class="mt-2 text-xs text-[var(--color-fg-muted)]">{{ importMessage }}</p>

      <div class="mt-6 rounded-xl border border-[var(--color-border-soft)] p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold">Backups SQLite</h3>
            <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
              Incluyen colección normal, colección privada y ajustes.
            </p>
          </div>
          <button
            type="button"
            class="btn-primary"
            :disabled="backupAction !== null"
            @click="createBackup"
          >
            {{ backupAction === 'create' ? 'Creando…' : 'Crear backup' }}
          </button>
        </div>

        <p v-if="backupMessage" class="mt-3 break-words text-xs text-brand-600" role="status">
          {{ backupMessage }}
        </p>
        <p v-if="backupError" class="mt-3 text-xs text-red-500" role="alert">
          {{ backupError }}
        </p>
        <p v-if="backupsLoading" class="mt-4 text-sm text-[var(--color-fg-muted)]">
          Cargando backups…
        </p>
        <p v-else-if="backups.length === 0" class="mt-4 text-sm text-[var(--color-fg-muted)]">
          No hay backups todavía.
        </p>
        <ul v-else class="mt-4 divide-y divide-[var(--color-border-soft)]">
          <li
            v-for="backup in backups"
            :key="backup.name"
            class="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="rounded-full bg-brand-500/10 px-2 py-0.5 text-xs font-semibold text-brand-600">
                  {{ backupKindLabel(backup.kind) }}
                </span>
                <span v-if="!backup.valid" class="text-xs font-semibold text-red-500">
                  No válido
                </span>
              </div>
              <p class="mt-1 break-all text-sm font-medium">{{ backup.name }}</p>
              <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
                {{ formatBackupDate(backup.createdAt) }} · {{ formatBackupSize(backup.size) }}
                <template v-if="backup.schemaVersion !== null"> · Esquema v{{ backup.schemaVersion }}</template>
              </p>
            </div>
            <button
              type="button"
              class="btn-danger shrink-0 self-start sm:self-auto"
              :disabled="!backup.valid || backupAction !== null"
              @click="restoreBackup(backup)"
            >
              {{ backupAction === `restore:${backup.name}` ? 'Restaurando…' : 'Restaurar' }}
            </button>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
