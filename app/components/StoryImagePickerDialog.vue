<script setup lang="ts">
const props = withDefaults(defineProps<{
  open: boolean
  mode: 'replace' | 'queue'
  characterIds: string[]
  initialCharacterId?: string | null
  initialImageId?: string | null
}>(), {
  initialCharacterId: null,
  initialImageId: null
})

const emit = defineEmits<{
  close: []
  select: [selection: { imageId: string; queueForNextResponse: boolean }]
}>()

const characters = useCharactersStore()
const selectedCharacterId = ref('')
const selectedImageId = ref('')
const queueForNextResponse = ref(false)

const availableCharacters = computed(() =>
  props.characterIds.flatMap((id) => {
    const character = characters.byId(id)
    return character ? [character] : []
  })
)
const availableImages = computed(() =>
  selectedCharacterId.value ? characters.imagesFor(selectedCharacterId.value) : []
)
const selectedImage = computed(() =>
  availableImages.value.find((image) => image.id === selectedImageId.value) ?? null
)

function selectCharacter(characterId: string) {
  selectedCharacterId.value = characterId
  const initial = characters.imagesFor(characterId)
    .find((image) => image.id === props.initialImageId)
  selectedImageId.value = initial?.id ?? characters.imagesFor(characterId)[0]?.id ?? ''
}

function initialize() {
  if (!props.open) return
  queueForNextResponse.value = false
  const requested = props.initialCharacterId && props.characterIds.includes(props.initialCharacterId)
    ? props.initialCharacterId
    : props.characterIds.length === 1
      ? props.characterIds[0]!
      : ''
  selectCharacter(requested)
}

function confirm() {
  if (!selectedImage.value) return
  emit('select', {
    imageId: selectedImage.value.id,
    queueForNextResponse: props.mode === 'queue' || queueForNextResponse.value
  })
}

function onKeydown(event: KeyboardEvent) {
  if (props.open && event.key === 'Escape') emit('close')
}

watch(() => props.open, initialize)
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="story-image-picker-title"
      @click.self="emit('close')"
    >
      <section class="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-[var(--color-surface)] shadow-2xl">
        <header class="flex items-center justify-between border-b border-[var(--color-border-soft)] px-4 py-3">
          <h2 id="story-image-picker-title" class="font-semibold">
            {{ mode === 'replace' ? 'Cambiar imagen' : 'Imagen para la próxima respuesta' }}
          </h2>
          <button type="button" class="btn-ghost h-9 w-9 px-0 py-0" aria-label="Cerrar selector de imagen" @click="emit('close')">×</button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <label v-if="availableCharacters.length > 1" class="mb-4 block text-sm font-medium">
            Personaje
            <select
              :value="selectedCharacterId"
              class="field mt-1"
              aria-label="Personaje para la imagen"
              @change="selectCharacter(($event.target as HTMLSelectElement).value)"
            >
              <option value="">Selecciona un personaje</option>
              <option v-for="character in availableCharacters" :key="character.id" :value="character.id">
                {{ character.name }}
              </option>
            </select>
          </label>

          <p v-if="selectedCharacterId && !availableImages.length" class="text-sm text-[var(--color-fg-muted)]">
            Este personaje no tiene imágenes.
          </p>
          <p v-else-if="!selectedCharacterId" class="text-sm text-[var(--color-fg-muted)]">
            Elige qué personaje quieres cambiar.
          </p>
          <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <button
              v-for="image in availableImages"
              :key="image.id"
              type="button"
              class="overflow-hidden rounded-xl border-2 bg-black/5 p-2 text-left transition"
              :class="image.id === selectedImageId ? 'border-brand-500 ring-2 ring-brand-500/25' : 'border-[var(--color-border-soft)]'"
              :aria-label="`Seleccionar imagen [${image.tags.join('][')}]`"
              :aria-pressed="image.id === selectedImageId"
              @click="selectedImageId = image.id"
            >
              <img :src="characters.urlFor(image.id)!" alt="" class="aspect-square w-full rounded-lg object-contain object-top">
              <span class="mt-2 block text-xs text-[var(--color-fg-muted)]">{{ image.tags.map((tag) => `[${tag}]`).join('') }}</span>
            </button>
          </div>

          <label v-if="mode === 'replace' && selectedImage" class="mt-4 flex items-start gap-2 text-sm">
            <input v-model="queueForNextResponse" type="checkbox" class="mt-0.5 h-4 w-4">
            <span>Indicar a la IA que use estas etiquetas en su próxima respuesta.</span>
          </label>
        </div>

        <footer class="flex justify-end gap-2 border-t border-[var(--color-border-soft)] px-4 py-3">
          <button type="button" class="btn-ghost" @click="emit('close')">Cancelar</button>
          <button type="button" class="btn-primary" :disabled="!selectedImage" @click="confirm">
            {{ mode === 'replace' ? 'Cambiar' : 'Preparar' }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
