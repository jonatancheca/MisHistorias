<script setup lang="ts">
import { tagKey } from '~/lib/tags'

const settings = useSettingsStore()
const catalog = useSwarmPromptsStore()
const characters = useCharactersStore()
const confirmDialog = useConfirmStore()
await Promise.all([settings.load(), catalog.load(), characters.load()])
const selectedId = ref<string | null>(null)
const name = ref('')
const prompt = ref('')
const tags = ref<string[]>([])
const busy = ref(false)
const error = ref('')
const notice = ref('')
const suggestions = computed(() => [...characters.images.flatMap((image) => image.tags),
  ...catalog.prompts.flatMap((item) => item.tags)].filter((tag) => tagKey(tag) !== 'neutral'))

function select(id: string | null) {
  selectedId.value = id
  const item = catalog.prompts.find((item) => item.id === id)
  name.value = item?.name ?? ''
  prompt.value = item?.prompt ?? ''
  tags.value = [...(item?.tags ?? [])]
  notice.value = ''
  error.value = ''
}

async function save() {
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const item = await catalog.save({ id: selectedId.value ?? undefined, name: name.value, prompt: prompt.value, tags: tags.value })
    select(item.id)
    notice.value = 'Prompt guardado.'
  } catch (caught) {
    error.value = (caught as Error).message
  } finally {
    busy.value = false
  }
}

async function remove() {
  const id = selectedId.value
  if (!id || !await confirmDialog.ask({ title: 'Borrar prompt SwarmUI', message: 'Este prompt se borrará definitivamente.' })) return
  busy.value = true
  error.value = ''
  try {
    await catalog.remove(id)
    select(null)
  } catch (caught) {
    error.value = (caught as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="page-shell">
    <template v-if="settings.settings.swarmBaseUrl.trim()">
      <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-2xl font-bold">Prompts SwarmUI</h1>
        <button type="button" class="btn-primary" :disabled="busy" @click="select(null)">Nuevo prompt</button>
      </header>
      <div class="grid min-w-0 gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
        <ul class="grid h-fit min-w-0 gap-1">
          <li v-for="item in catalog.prompts" :key="item.id">
            <button
              type="button" class="w-full break-words rounded-lg px-3 py-2 text-left text-sm"
              :class="item.id === selectedId ? 'bg-brand-500 text-white' : 'hover:bg-brand-500/10'"
              :disabled="busy" @click="select(item.id)">{{ item.name }}</button>
          </li>
          <li v-if="!catalog.prompts.length" class="text-sm text-[var(--color-fg-muted)]">Sin prompts todavía.</li>
        </ul>
        <form class="grid min-w-0 gap-4" @submit.prevent="save">
          <div>
            <label class="label" for="swarm-prompt-name">Nombre</label>
            <input id="swarm-prompt-name" v-model="name" required autocomplete="off" class="field">
          </div>
          <div>
            <label class="label" for="swarm-prompt-tags">Etiquetas de imagen</label>
            <TagInput id="swarm-prompt-tags" v-model="tags" :suggestions="suggestions" show-all-suggestions placeholder="feliz" />
          </div>
          <div>
            <label class="label" for="swarm-prompt-content">Prompt</label>
            <textarea id="swarm-prompt-content" v-model="prompt" required maxlength="100000" class="field min-h-48" />
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="submit" class="btn-primary" :disabled="busy || !name.trim() || !prompt.trim()">Guardar</button>
            <button type="button" class="btn-danger" :disabled="busy || !selectedId" @click="remove">Borrar</button>
          </div>
          <p v-if="error" role="alert" class="text-sm text-red-500">{{ error }}</p>
          <p v-if="notice" role="status" class="text-sm text-green-600">{{ notice }}</p>
        </form>
      </div>
    </template>
    <p v-else>Indica la URL de SwarmUI en <NuxtLink to="/settings" class="underline">Ajustes</NuxtLink>.</p>
  </div>
</template>
