<script setup lang="ts">
import type { Message } from '#shared/types'
import { DEFAULT_USER_COLOR, normalizeColor } from '~/lib/colors'

const props = defineProps<{ message: Message; editable?: boolean }>()
const emit = defineEmits<{ edit: [string]; remove: []; regenerate: [] }>()

const characters = useCharactersStore()
const settings = useSettingsStore()
const editing = ref(false)
const buffer = ref('')

const userName = computed(() => settings.settings.userName?.trim() || 'Usuario')
const userColor = computed(() => normalizeColor(settings.settings.userColor, DEFAULT_USER_COLOR))

interface FlowRow {
  key: string
  narration: boolean
  text: string
  name: string
  color: string
  tag: string | null
  imageUrl: string | null
}

/**
 * Convierte los segmentos en un flujo narrativo. La imagen solo se inserta
 * cuando cambia respecto a la anterior mostrada, para no repetirla en cada línea.
 */
const rows = computed<FlowRow[]>(() => {
  let lastImageId = ''
  return props.message.segments.map((segment, index) => {
    if (segment.type !== 'dialogue' || !segment.characterId) {
      return {
        key: String(index),
        narration: true,
        text: segment.text,
        name: '',
        color: '',
        tag: null,
        imageUrl: null
      }
    }

    const image = characters.resolveImage(segment.characterId, segment.tag)
    const isNewImage = Boolean(image) && image!.id !== lastImageId
    if (image) lastImageId = image.id

    return {
      key: String(index),
      narration: false,
      text: segment.text,
      name: characters.byId(segment.characterId)?.name ?? 'Personaje',
      color: characters.colorOf(segment.characterId),
      tag: image?.tag ?? segment.tag,
      imageUrl: isNewImage ? characters.urlFor(image!.id) : null
    }
  })
})

function startEdit() {
  buffer.value = props.message.raw
  editing.value = true
}

function confirmEdit() {
  editing.value = false
  emit('edit', buffer.value)
}
</script>

<template>
  <div class="group">
    <template v-if="editing">
      <textarea v-model="buffer" class="field min-h-28" />
      <div class="mt-2 flex gap-2">
        <button type="button" class="btn-primary" @click="confirmEdit">Guardar</button>
        <button type="button" class="btn-ghost" @click="editing = false">Cancelar</button>
      </div>
    </template>

    <template v-else-if="message.role === 'user'">
      <p class="text-[15px] leading-relaxed">
        <span class="font-semibold" :style="{ color: userColor }">{{ userName }}:</span>
        <span class="ml-1 whitespace-pre-wrap">{{ message.raw }}</span>
      </p>
    </template>

    <template v-else>
      <div class="space-y-2">
        <div v-for="row in rows" :key="row.key">
          <p
            v-if="row.narration"
            class="text-[15px] leading-relaxed whitespace-pre-wrap text-[var(--color-fg-muted)] italic"
          >
            {{ row.text }}
          </p>
          <template v-else>
            <p class="text-[15px] leading-relaxed">
              <span class="font-semibold" :style="{ color: row.color }">{{ row.name }}</span>
              <span v-if="row.tag" class="text-xs text-[var(--color-fg-muted)]"> [{{ row.tag }}]</span>
              <span class="font-semibold" :style="{ color: row.color }">:</span>
              <span class="ml-1 whitespace-pre-wrap" :style="{ color: row.color }">{{ row.text }}</span>
            </p>
            <figure v-if="row.imageUrl" class="mt-2 mb-3 w-40">
              <img
                :src="row.imageUrl"
                :alt="`${row.name} ${row.tag ?? ''}`"
                class="aspect-square w-40 rounded-xl object-cover"
                :style="{ border: `2px solid ${row.color}` }"
              />
              <figcaption class="mt-1 text-xs text-[var(--color-fg-muted)]">
                {{ row.name }}<span v-if="row.tag"> · {{ row.tag }}</span>
              </figcaption>
            </figure>
          </template>
        </div>
        <p v-if="message.segments.length === 0" class="text-sm text-[var(--color-fg-muted)]">…</p>
      </div>
    </template>

    <div
      v-if="editable && !editing"
      class="mt-1 flex gap-3 text-xs text-[var(--color-fg-muted)] opacity-0 transition group-hover:opacity-100"
    >
      <button type="button" class="hover:text-brand-600" @click="startEdit">Editar</button>
      <button type="button" class="hover:text-brand-600" @click="emit('remove')">Borrar</button>
      <button
        v-if="message.role === 'assistant'"
        type="button"
        class="hover:text-brand-600"
        @click="emit('regenerate')"
      >
        Regenerar
      </button>
    </div>
  </div>
</template>
