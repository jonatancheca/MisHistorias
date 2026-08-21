<script setup lang="ts">
definePageMeta({ layout: 'private' })

const displayName = ref('')
const pronouns = ref('')
const appearance = ref('')
const boundaries = ref('')
const primary = ref<string[]>([])
const excluded = ref<string[]>([])
const contextual = ref<string[]>([])
const customLabel = ref('')
const termFilter = ref('')
const message = ref<string | null>(null)
const termError = ref<string | null>(null)
const ratingsCount = ref(0)
const tasteUnlocked = ref(false)
const minTaste = ref(3)

type CatalogTerm = { id: string; label: string; facet: string; private: boolean }

const catalog = ref<CatalogTerm[]>([])
const privateTerms = ref<Array<{ id: string; label: string }>>([])

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
  primary.value = [...(payload.profile.adultDefaults?.primary || [])]
  excluded.value = [...(payload.profile.adultDefaults?.excluded || [])]
  contextual.value = [...(payload.profile.adultDefaults?.contextual || [])]
}
ratingsCount.value = payload.ratingsCount
tasteUnlocked.value = payload.tasteUnlocked
minTaste.value = payload.minTasteRatings

async function refreshTerms() {
  const result = await $fetch<{
    catalog: CatalogTerm[]
    privateTerms: Array<{ id: string; label: string }>
  }>('/api/private/terms')
  catalog.value = result.catalog
  privateTerms.value = result.privateTerms
}

await refreshTerms()

const filteredTerms = computed(() => {
  const q = termFilter.value.trim().toLocaleLowerCase('es-ES')
  return catalog.value
    .filter((term) => !q || `${term.label} ${term.facet}`.toLocaleLowerCase('es-ES').includes(q))
    .slice(0, 80)
})

function splitList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function unique(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))]
}

function classify(label: string, kind: 'primary' | 'excluded' | 'contextual') {
  primary.value = primary.value.filter((item) => item !== label)
  excluded.value = excluded.value.filter((item) => item !== label)
  contextual.value = contextual.value.filter((item) => item !== label)
  if (kind === 'primary') {
    if (primary.value.length >= 5) return
    primary.value = unique([...primary.value, label]).slice(0, 5)
  } else if (kind === 'excluded') {
    excluded.value = unique([...excluded.value, label])
  } else {
    contextual.value = unique([...contextual.value, label])
  }
}

function clearClassification(label: string) {
  primary.value = primary.value.filter((item) => item !== label)
  excluded.value = excluded.value.filter((item) => item !== label)
  contextual.value = contextual.value.filter((item) => item !== label)
}

async function createPrivate() {
  const label = customLabel.value.trim().replace(/\s+/g, ' ')
  if (!label) return
  termError.value = null
  try {
    const result = await $fetch<{
      catalog: CatalogTerm[]
      privateTerms: Array<{ id: string; label: string }>
      term: { label: string }
    }>('/api/private/terms', {
      method: 'POST',
      body: { label }
    })
    catalog.value = result.catalog
    privateTerms.value = result.privateTerms
    customLabel.value = ''
    message.value = `Privado creado: ${result.term.label}`
  } catch (caught) {
    termError.value =
      caught && typeof caught === 'object' && 'data' in caught
        ? String((caught as { data?: { statusMessage?: string } }).data?.statusMessage || 'Error')
        : 'No se pudo crear'
  }
}

async function removePrivate(termId: string, label: string) {
  termError.value = null
  try {
    const result = await $fetch<{
      catalog: CatalogTerm[]
      privateTerms: Array<{ id: string; label: string }>
    }>(`/api/private/terms?id=${encodeURIComponent(termId)}`, {
      method: 'DELETE'
    })
    catalog.value = result.catalog
    privateTerms.value = result.privateTerms
    clearClassification(label)
  } catch (caught) {
    termError.value =
      caught && typeof caught === 'object' && 'data' in caught
        ? String((caught as { data?: { statusMessage?: string } }).data?.statusMessage || 'Error')
        : 'No se pudo borrar'
  }
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
        primary: primary.value.slice(0, 5),
        excluded: excluded.value,
        contextual: contextual.value
      }
    }
  })
  message.value = 'Perfil guardado'
}
</script>

<template>
  <div class="nsfw-page mx-auto max-w-3xl px-3 py-8 sm:px-6">
    <header class="mb-6">
      <h1 class="font-serif text-3xl">Self-insert y preferencias</h1>
      <p class="mt-2 text-sm text-[var(--nsfw-muted)]">
        Cómo te representan las sesiones y qué intereses se precargan al crear.
      </p>
    </header>
    <p v-if="message" class="mb-4 text-sm text-[var(--nsfw-success)]" role="status">{{ message }}</p>
    <p v-if="termError" class="mb-4 text-sm text-[var(--nsfw-danger)]">{{ termError }}</p>

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
          Predominantes máx. 5; exclusiones nunca; contextuales = permitidos si encajan.
          Las etiquetas <em>privado</em> son solo tuyas y permanecen en el catálogo.
        </p>
        <div class="interest-legend mb-3">
          <span class="positive">Predominante</span>
          <span class="negative">Excluir</span>
          <span class="contextual">Permitido si encaja</span>
        </div>
        <label class="mb-3 block">
          <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Buscar</span>
          <input v-model="termFilter" class="nsfw-input w-full" placeholder="Filtra">
        </label>
        <div class="term-matrix mb-4">
          <article v-for="term in filteredTerms" :key="term.id">
            <div>
              <strong>{{ term.label }}</strong>
              <small>{{ term.private ? 'privado' : term.facet }}</small>
            </div>
            <div>
              <button
                type="button"
                class="term-action positive"
                :class="primary.includes(term.label) ? 'selected' : ''"
                @click="classify(term.label, 'primary')"
              >
                Preferir
              </button>
              <button
                type="button"
                class="term-action negative"
                :class="excluded.includes(term.label) ? 'selected' : ''"
                @click="classify(term.label, 'excluded')"
              >
                Excluir
              </button>
              <button
                type="button"
                class="term-action contextual"
                :class="contextual.includes(term.label) ? 'selected' : ''"
                @click="classify(term.label, 'contextual')"
              >
                Permitir
              </button>
              <button
                v-if="term.private"
                type="button"
                class="term-action delete"
                title="Eliminar privado"
                @click="removePrivate(term.id, term.label)"
              >
                ×
              </button>
            </div>
          </article>
        </div>
        <label class="block">
          <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Nuevo término privado</span>
          <span class="flex gap-2">
            <input
              v-model="customLabel"
              class="nsfw-input flex-1"
              maxlength="80"
              placeholder="Solo para ti; no duplica públicos"
              @keydown.enter.prevent="createPrivate"
            >
            <button type="button" class="nsfw-btn-ghost" @click="createPrivate">Crear</button>
          </span>
        </label>
        <p v-if="privateTerms.length" class="mt-2 text-xs text-[var(--nsfw-muted)]">
          {{ privateTerms.length }} etiqueta(s) privada(s) en tu catálogo.
        </p>
      </div>

      <p class="text-xs text-[var(--nsfw-faint)]">
        Valoraciones Hub: {{ ratingsCount }}. «De las que me gustan» se activa con
        {{ minTaste }}+ ({{ tasteUnlocked ? 'activa' : 'aún no' }}).
      </p>
      <button type="submit" class="nsfw-btn-primary">Guardar</button>
    </form>
  </div>
</template>
