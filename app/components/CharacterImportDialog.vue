<script setup lang="ts">
import type { Character } from '#shared/types'

const props = defineProps<{
  importedName: string
  matches: Character[]
}>()

const emit = defineEmits<{
  cancel: []
  create: [name: string]
  replace: [id: string]
}>()

const panel = ref<HTMLElement | null>(null)
const phase = ref<'choice' | 'create' | 'select' | 'confirm'>('choice')
const newName = ref(props.importedName)
const replaceId = ref(props.matches[0]?.id ?? '')

async function focusFirst() {
  await nextTick()
  panel.value?.querySelector<HTMLElement>('button, input')?.focus()
}

watch(
  () => [props.importedName, props.matches.map((match) => match.id).join(',')],
  () => {
    phase.value = 'choice'
    newName.value = props.importedName
    replaceId.value = props.matches[0]?.id ?? ''
    void focusFirst()
  },
  { immediate: true }
)

watch(phase, focusFirst)

function beginReplace() {
  if (props.matches.length === 1) {
    replaceId.value = props.matches[0]!.id
    phase.value = 'confirm'
  } else {
    phase.value = 'select'
  }
}

function trapFocus(event: KeyboardEvent) {
  const items = Array.from(
    panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []
  )
  if (items.length === 0) return
  const current = items.indexOf(document.activeElement as HTMLElement)
  const next = event.shiftKey
    ? (current - 1 + items.length) % items.length
    : (current + 1) % items.length
  items[next]?.focus()
}

function selectedCharacter() {
  return props.matches.find((match) => match.id === replaceId.value) ?? null
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="emit('cancel')"
      @keydown.esc.stop.prevent="emit('cancel')"
      @keydown.tab.prevent="trapFocus"
    >
      <section
        ref="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="character-import-title"
        class="w-full max-w-lg rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-5 shadow-2xl"
      >
        <template v-if="phase === 'choice'">
          <h2 id="character-import-title" class="text-lg font-bold">Ya existe «{{ importedName }}»</h2>
          <p class="mt-2 text-sm text-[var(--color-fg-muted)]">
            Cancela, crea otro personaje o reemplaza uno existente.
          </p>
          <div class="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" class="btn-ghost" @click="emit('cancel')">Cancelar</button>
            <button type="button" class="btn-ghost" @click="phase = 'create'">Crear nuevo</button>
            <button type="button" class="btn-danger" @click="beginReplace">Reemplazar</button>
          </div>
        </template>

        <template v-else-if="phase === 'create'">
          <h2 id="character-import-title" class="text-lg font-bold">Crear personaje importado</h2>
          <label for="imported-character-name" class="label mt-4">Nombre</label>
          <input
            id="imported-character-name"
            v-model="newName"
            class="field"
            autocomplete="off"
          >
          <p class="mt-2 text-xs text-[var(--color-fg-muted)]">Se permiten nombres duplicados.</p>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="phase = 'choice'">Volver</button>
            <button
              type="button"
              class="btn-primary"
              :disabled="!newName.trim()"
              @click="emit('create', newName.trim())"
            >
              Importar
            </button>
          </div>
        </template>

        <template v-else-if="phase === 'select'">
          <h2 id="character-import-title" class="text-lg font-bold">Elige personaje a reemplazar</h2>
          <div class="mt-4 grid max-h-72 gap-2 overflow-y-auto">
            <label
              v-for="match in matches"
              :key="match.id"
              class="flex cursor-pointer gap-3 rounded-xl border border-[var(--color-border-soft)] p-3"
            >
              <input v-model="replaceId" type="radio" name="replace-character" :value="match.id" >
              <span class="min-w-0">
                <strong class="block truncate">{{ match.name }}</strong>
                <span class="block truncate text-xs text-[var(--color-fg-muted)]">
                  {{ match.prompt || 'Sin prompt' }} · {{ match.id }}
                </span>
              </span>
            </label>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="phase = 'choice'">Volver</button>
            <button type="button" class="btn-danger" :disabled="!replaceId" @click="phase = 'confirm'">
              Continuar
            </button>
          </div>
        </template>

        <template v-else>
          <h2 id="character-import-title" class="text-lg font-bold">Confirmar reemplazo</h2>
          <p class="mt-2 text-sm text-[var(--color-fg-muted)]">
            Se reemplazarán ficha, imágenes y sonidos de «{{ selectedCharacter()?.name }}».
            Sus historias conservarán el vínculo. Esta acción no se puede deshacer.
          </p>
          <div class="mt-5 flex justify-end gap-2">
            <button
              type="button"
              class="btn-ghost"
              @click="phase = matches.length > 1 ? 'select' : 'choice'"
            >
              Volver
            </button>
            <button type="button" class="btn-danger" @click="emit('replace', replaceId)">
              Reemplazar
            </button>
          </div>
        </template>
      </section>
    </div>
  </Teleport>
</template>
