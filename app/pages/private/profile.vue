<script setup lang="ts">
definePageMeta({ layout: 'private' })

const displayName = ref('')
const pronouns = ref('')
const appearance = ref('')
const boundaries = ref('')
const primaryText = ref('')
const excludedText = ref('')
const contextualText = ref('')
const message = ref<string | null>(null)
const ratingsCount = ref(0)
const tasteUnlocked = ref(false)
const minTaste = ref(3)

const payload = await $fetch<{
  profile: {
    displayName: string
    pronouns: string
    appearance: string
    boundaries: string[]
    adultDefaults?: { primary: string[]; excluded: string[]; contextual: string[] }
  } | null
  ratingsCount: number
  tasteUnlocked: boolean
  minTasteRatings: number
}>('/api/private/profile/self-insert')

if (payload.profile) {
  displayName.value = payload.profile.displayName
  pronouns.value = payload.profile.pronouns
  appearance.value = payload.profile.appearance
  boundaries.value = payload.profile.boundaries.join(', ')
  primaryText.value = (payload.profile.adultDefaults?.primary || []).join(', ')
  excludedText.value = (payload.profile.adultDefaults?.excluded || []).join(', ')
  contextualText.value = (payload.profile.adultDefaults?.contextual || []).join(', ')
}
ratingsCount.value = payload.ratingsCount
tasteUnlocked.value = payload.tasteUnlocked
minTaste.value = payload.minTasteRatings

function splitList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

async function save() {
  await $fetch('/api/private/profile/self-insert', {
    method: 'POST',
    body: {
      displayName: displayName.value,
      pronouns: pronouns.value,
      appearance: appearance.value,
      boundaries: splitList(boundaries.value),
      adultDefaults: {
        primary: splitList(primaryText.value).slice(0, 5),
        excluded: splitList(excludedText.value),
        contextual: splitList(contextualText.value)
      }
    }
  })
  message.value = 'Perfil guardado'
}
</script>

<template>
  <div class="nsfw-page mx-auto max-w-2xl px-3 py-8 sm:px-6">
    <header class="mb-6">
      <h1 class="font-serif text-3xl">Self-insert y preferencias</h1>
      <p class="mt-2 text-sm text-[var(--nsfw-muted)]">
        Cómo te representan las sesiones y qué intereses se precargan al crear.
      </p>
    </header>
    <p v-if="message" class="mb-4 text-sm text-[var(--nsfw-success)]" role="status">{{ message }}</p>
    <form class="nsfw-card space-y-4" @submit.prevent="save">
      <label class="block">
        <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Nombre en escena</span>
        <input v-model="displayName" class="nsfw-input w-full" autocomplete="nickname">
      </label>
      <label class="block">
        <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Pronombres</span>
        <input v-model="pronouns" class="nsfw-input w-full">
      </label>
      <label class="block">
        <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Apariencia</span>
        <textarea v-model="appearance" class="nsfw-input min-h-24 w-full" />
      </label>
      <label class="block">
        <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Límites duros (coma)</span>
        <input v-model="boundaries" class="nsfw-input w-full" placeholder="Ej. no sangre, no no-con">
      </label>

      <div class="border-t border-[var(--nsfw-line)] pt-4">
        <h2 class="mb-2 font-serif text-xl">Defaults adultos</h2>
        <p class="mb-3 text-sm text-[var(--nsfw-muted)]">
          Se precargan al crear historia. Predominantes máx. 5; exclusiones nunca aparecen;
          contextuales = permitidos si encajan.
        </p>
        <label class="mb-3 block">
          <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Predominantes</span>
          <input v-model="primaryText" class="nsfw-input w-full" placeholder="romance, tensión…">
        </label>
        <label class="mb-3 block">
          <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Exclusiones</span>
          <input v-model="excludedText" class="nsfw-input w-full">
        </label>
        <label class="block">
          <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Permitidos si encajan</span>
          <input v-model="contextualText" class="nsfw-input w-full">
        </label>
      </div>

      <p class="text-xs text-[var(--nsfw-faint)]">
        Valoraciones Hub: {{ ratingsCount }}. «De las que me gustan» se activa con
        {{ minTaste }}+ ({{ tasteUnlocked ? 'activa' : 'aún no' }}).
      </p>
      <button type="submit" class="nsfw-btn-primary">Guardar</button>
    </form>
  </div>
</template>
