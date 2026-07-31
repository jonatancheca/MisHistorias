<script setup lang="ts">
const props = defineProps<{ characterId: string }>()

const characters = useCharactersStore()
const fileInput = ref<HTMLInputElement | null>(null)
const pendingTag = ref('')
const pendingDescription = ref('')
const busy = ref(false)

const images = computed(() => characters.imagesFor(props.characterId))

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  busy.value = true
  try {
    await characters.addImage(props.characterId, file, pendingTag.value, pendingDescription.value)
    pendingTag.value = ''
    pendingDescription.value = ''
  } finally {
    busy.value = false
    input.value = ''
  }
}

async function remove(id: string) {
  await characters.removeImage(id)
}
</script>

<template>
  <section>
    <h2 class="mb-1 text-lg font-semibold">Imágenes</h2>
    <p class="mb-4 text-sm text-[var(--color-fg-muted)]">
      La etiqueta es lo que el modelo escribe entre corchetes. La descripción le ayuda a elegir.
      Las imágenes se redimensionan a 1024px y se guardan en WebP.
    </p>

    <div class="card mb-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
      <div>
        <label class="label" for="new-tag">Etiqueta</label>
        <input id="new-tag" v-model="pendingTag" class="field" placeholder="feliz" />
      </div>
      <div>
        <label class="label" for="new-desc">Descripción</label>
        <input
          id="new-desc"
          v-model="pendingDescription"
          class="field"
          placeholder="Sonríe, relajada, mirando de frente"
        />
      </div>
      <div>
        <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFile" />
        <button type="button" class="btn-primary w-full" :disabled="busy" @click="fileInput?.click()">
          {{ busy ? 'Procesando…' : 'Añadir imagen' }}
        </button>
      </div>
    </div>

    <p v-if="images.length === 0" class="text-sm text-[var(--color-fg-muted)]">
      Sin imágenes todavía.
    </p>

    <ul class="grid gap-3 sm:grid-cols-2">
      <li v-for="image in images" :key="image.id" class="card flex gap-3">
        <img
          :src="characters.urlFor(image.id)!"
          alt=""
          class="h-24 w-24 shrink-0 rounded-lg object-cover"
        />
        <div class="min-w-0 flex-1 space-y-2">
          <input
            class="field"
            :value="image.tag"
            placeholder="etiqueta"
            @change="characters.updateImage(image.id, { tag: ($event.target as HTMLInputElement).value })"
          />
          <input
            class="field"
            :value="image.description"
            placeholder="descripción"
            @change="
              characters.updateImage(image.id, {
                description: ($event.target as HTMLInputElement).value
              })
            "
          />
          <div class="flex items-center justify-between gap-2">
            <label class="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
              <input
                type="radio"
                :name="`default-${characterId}`"
                :checked="image.isDefault"
                class="accent-brand-500"
                @change="characters.updateImage(image.id, { isDefault: true })"
              />
              Por defecto
            </label>
            <button type="button" class="btn-danger" @click="remove(image.id)">Borrar</button>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>
