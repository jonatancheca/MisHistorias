<script setup lang="ts">
const presets = usePresetsStore()
const settings = useSettingsStore()
const confirmDialog = useConfirmStore()
await Promise.all([presets.load(), settings.load()])

const selectedId = ref<string | null>(settings.activePresetId ?? presets.presets[0]?.id ?? null)
const name = ref('')
const content = ref('')
const saving = ref(false)

function loadSelected() {
  const preset = presets.byId(selectedId.value)
  name.value = preset?.name ?? ''
  content.value = preset?.content ?? ''
}
loadSelected()
watch(selectedId, loadSelected)

function startNew() {
  selectedId.value = null
  name.value = 'Nuevo prompt'
  content.value = ''
}

async function save() {
  saving.value = true
  try {
    const preset = await presets.savePreset({
      id: selectedId.value ?? undefined,
      name: name.value,
      content: content.value
    })
    selectedId.value = preset.id
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!selectedId.value) return
  const accepted = await confirmDialog.ask({
    title: 'Borrar prompt',
    message: 'Este prompt se borrará definitivamente.'
  })
  if (!accepted) return
  await presets.removePreset(selectedId.value)
  selectedId.value = presets.presets[0]?.id ?? null
  loadSelected()
}

async function setActive() {
  if (selectedId.value) await settings.setActivePresetId(selectedId.value)
}
</script>

<template>
  <div class="mx-auto max-w-5xl p-8">
    <header class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">Prompts de preparación</h1>
        <p class="text-sm text-[var(--color-fg-muted)]">
          Instrucciones base que reciben todas las historias.
        </p>
      </div>
      <button type="button" class="btn-primary" @click="startNew">Nuevo prompt</button>
    </header>

    <div class="grid gap-6 md:grid-cols-[220px_1fr]">
      <ul class="grid h-fit gap-1">
        <li v-for="preset in presets.presets" :key="preset.id">
          <button
            type="button"
            class="w-full rounded-lg px-3 py-2 text-left text-sm transition"
            :class="
              preset.id === selectedId
                ? 'bg-brand-500 text-white'
                : 'text-[var(--color-fg-muted)] hover:bg-brand-500/10'
            "
            @click="selectedId = preset.id"
          >
            {{ preset.name }}
            <span
              v-if="preset.id === settings.activePresetId"
              class="ml-1 text-xs opacity-70"
            >
              (activo)
            </span>
          </button>
        </li>
      </ul>

      <form class="grid gap-4" @submit.prevent="save">
        <div>
          <label class="label" for="preset-name">Nombre</label>
          <input id="preset-name" v-model="name" class="field" >
        </div>
        <div>
          <label class="label" for="preset-content">Contenido</label>
          <textarea id="preset-content" v-model="content" class="field min-h-96 font-mono text-xs" />
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="submit" class="btn-primary" :disabled="saving">Guardar</button>
          <button
            type="button"
            class="btn-ghost"
            :disabled="!selectedId || selectedId === settings.activePresetId"
            @click="setActive"
          >
            Marcar como activo
          </button>
          <button
            type="button"
            class="btn-danger"
            :disabled="!selectedId || presets.presets.length <= 1"
            @click="remove"
          >
            Borrar
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
