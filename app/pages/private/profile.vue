<script setup lang="ts">
import {
  MAX_PRIMARY_INTERESTS,
  sortInterestTerms
} from '../../../shared/lib/nsfwCreatorConfig.ts'

definePageMeta({ layout: 'private' })

const auth = useNsfwAuthStore()
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

const initial = computed(() =>
  (displayName.value || auth.user?.username || '?').slice(0, 1).toLocaleUpperCase('es-ES')
)

const filteredTerms = computed(() => {
  const q = termFilter.value.trim().toLocaleLowerCase('es-ES')
  const matching = catalog.value.filter(
    (term) => !q || `${term.label} ${term.facet}`.toLocaleLowerCase('es-ES').includes(q)
  )
  return sortInterestTerms(matching, {
    primary: primary.value,
    excluded: excluded.value,
    contextual: contextual.value
  }).slice(0, 120)
})

const primaryFull = computed(() => primary.value.length >= MAX_PRIMARY_INTERESTS)

function splitList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function unique(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))]
}

function clearClassification(label: string) {
  primary.value = primary.value.filter((item) => item !== label)
  excluded.value = excluded.value.filter((item) => item !== label)
  contextual.value = contextual.value.filter((item) => item !== label)
}

function classify(label: string, kind: 'primary' | 'excluded' | 'contextual') {
  const wasSelected =
    kind === 'primary'
      ? primary.value.includes(label)
      : kind === 'excluded'
        ? excluded.value.includes(label)
        : contextual.value.includes(label)
  clearClassification(label)
  if (wasSelected) return
  if (kind === 'primary') {
    if (primary.value.length >= MAX_PRIMARY_INTERESTS) return
    primary.value = unique([...primary.value, label]).slice(0, MAX_PRIMARY_INTERESTS)
  } else if (kind === 'excluded') {
    excluded.value = unique([...excluded.value, label])
  } else {
    contextual.value = unique([...contextual.value, label])
  }
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
    termFilter.value = result.term.label
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
        primary: primary.value.slice(0, MAX_PRIMARY_INTERESTS),
        excluded: excluded.value,
        contextual: contextual.value
      }
    }
  })
  message.value = 'Perfil guardado'
}
</script>

<template>
  <form class="nsfw-page mx-auto max-w-[58rem] px-5 py-10 sm:px-12 sm:py-14" @submit.prevent="save">
    <header class="mb-9 flex items-center gap-4">
      <span class="nsfw-avatar is-gold h-14 w-14 text-2xl">{{ initial }}</span>
      <div>
        <h1 class="font-serif text-3xl">{{ displayName || auth.user?.username }}</h1>
        <p class="text-xs text-[var(--nsfw-faint)]">
          {{ auth.isAdmin ? 'Administrador' : 'Lector' }} · self-insert «{{ displayName || 'Tú' }}»
        </p>
      </div>
    </header>

    <p v-if="message" class="mb-4 text-sm text-[var(--nsfw-success)]" role="status">{{ message }}</p>
    <p v-if="termError" class="mb-4 text-sm text-[var(--nsfw-danger)]">{{ termError }}</p>

    <section class="mb-11">
      <div class="nsfw-section-head">
        <h3>Cómo apareces en las historias</h3>
      </div>
      <div class="grid gap-6 sm:grid-cols-2">
        <label class="block">
          <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Nombre en escena</span>
          <input v-model="displayName" class="nsfw-underline" autocomplete="nickname">
        </label>
        <label class="block">
          <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Pronombres</span>
          <input v-model="pronouns" class="nsfw-underline">
        </label>
        <label class="block sm:col-span-2">
          <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Apariencia</span>
          <textarea v-model="appearance" class="nsfw-input min-h-24 w-full" />
        </label>
        <label class="block sm:col-span-2">
          <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Límites duros (coma)</span>
          <input v-model="boundaries" class="nsfw-underline" placeholder="Ej. no sangre, no no-con">
        </label>
      </div>
    </section>

    <section>
      <div class="nsfw-section-head">
        <h3>Intereses y límites por defecto</h3>
        <span class="text-xs text-[var(--nsfw-dim)]">
          se precargan al crear cada historia
        </span>
      </div>
      <p class="mb-6 max-w-[66ch] font-serif text-[1.05rem] italic leading-relaxed text-[var(--nsfw-muted)]">
        Predominantes, máximo {{ MAX_PRIMARY_INTERESTS }} para que ninguno se diluya. Excluir y
        «si encaja» no tienen límite.
      </p>

      <div class="flex flex-col gap-10 lg:flex-row lg:gap-14">
        <div class="min-w-0 flex-1">
          <div
            class="mb-1 flex flex-wrap items-center gap-4 border-b border-[var(--nsfw-line-strong)] pb-2.5"
          >
            <label class="min-w-[10rem] flex-1">
              <span class="sr-only">Filtrar etiquetas</span>
              <input
                v-model="termFilter"
                class="w-full border-0 bg-transparent text-sm text-[var(--nsfw-ink)] outline-none placeholder:text-[var(--nsfw-dim)]"
                :placeholder="`Filtrar entre ${catalog.length} etiquetas…`"
              >
            </label>
            <label class="flex items-center gap-2">
              <span class="sr-only">Nueva etiqueta privada</span>
              <input
                v-model="customLabel"
                class="w-36 border-0 bg-transparent text-xs text-[var(--nsfw-ink)] outline-none placeholder:text-[var(--nsfw-faint)]"
                maxlength="80"
                placeholder="+ Crear etiqueta privada"
                @keydown.enter.prevent="createPrivate"
              >
              <button
                v-if="customLabel.trim()"
                type="button"
                class="nsfw-btn-text !text-[var(--nsfw-accent)]"
                @click="createPrivate"
              >
                Crear
              </button>
            </label>
          </div>

          <div
            v-for="term in filteredTerms"
            :key="term.id"
            class="flex items-center justify-between gap-4 border-b border-[var(--nsfw-hair)] py-3"
          >
            <div class="min-w-0">
              <p class="truncate text-sm">
                {{ term.label }}
                <span
                  v-if="term.private"
                  class="ml-2 text-[0.62rem] uppercase tracking-[0.14em] text-[var(--nsfw-gold)]"
                >
                  privada
                </span>
              </p>
              <p class="text-[0.7rem] text-[var(--nsfw-dim)]">
                {{ term.private ? 'solo tuya' : term.facet }}
              </p>
            </div>
            <div class="flex shrink-0 gap-1.5">
              <button
                type="button"
                class="term-action positive"
                :class="primary.includes(term.label) ? 'selected' : ''"
                :aria-pressed="primary.includes(term.label)"
                :disabled="primaryFull && !primary.includes(term.label)"
                title="Predominante"
                @click="classify(term.label, 'primary')"
              >
                <NsfwInterestIcon kind="primary" :filled="primary.includes(term.label)" />
              </button>
              <button
                type="button"
                class="term-action negative"
                :class="excluded.includes(term.label) ? 'selected' : ''"
                :aria-pressed="excluded.includes(term.label)"
                title="Excluir"
                @click="classify(term.label, 'excluded')"
              >
                <NsfwInterestIcon kind="excluded" />
              </button>
              <button
                type="button"
                class="term-action contextual"
                :class="contextual.includes(term.label) ? 'selected' : ''"
                :aria-pressed="contextual.includes(term.label)"
                title="Si encaja"
                @click="classify(term.label, 'contextual')"
              >
                <NsfwInterestIcon kind="contextual" />
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
          </div>

          <p v-if="privateTerms.length" class="mt-4 text-xs text-[var(--nsfw-dim)]">
            {{ privateTerms.length }} etiqueta(s) privada(s) en tu catálogo. Nunca se publican al Hub.
          </p>
        </div>

        <aside class="nsfw-summary w-full shrink-0 lg:w-[21rem]">
          <p class="nsfw-eyebrow nsfw-eyebrow--dim mb-4">Por defecto</p>

          <div class="mb-5">
            <p class="mb-2.5 flex items-center gap-2 text-xs text-[var(--nsfw-positive)]">
              <NsfwInterestIcon kind="primary" filled />
              Predominante · {{ primary.length }} de {{ MAX_PRIMARY_INTERESTS }}
            </p>
            <div class="custom-pills">
              <button
                v-for="label in primary"
                :key="`p-${label}`"
                type="button"
                class="pill positive !min-h-8 !py-1 !text-xs"
                @click="clearClassification(label)"
              >
                {{ label }} ×
              </button>
              <span v-if="!primary.length" class="text-xs text-[var(--nsfw-dim)]">Ninguno.</span>
            </div>
          </div>

          <div class="mb-5">
            <p class="mb-2.5 flex items-center gap-2 text-xs text-[var(--nsfw-negative)]">
              <NsfwInterestIcon kind="excluded" />
              Excluir · {{ excluded.length }}
            </p>
            <div class="custom-pills">
              <button
                v-for="label in excluded"
                :key="`e-${label}`"
                type="button"
                class="pill negative !min-h-8 !py-1 !text-xs"
                @click="clearClassification(label)"
              >
                {{ label }} ×
              </button>
              <span v-if="!excluded.length" class="text-xs text-[var(--nsfw-dim)]">Ninguno.</span>
            </div>
          </div>

          <div class="mb-6">
            <p class="mb-2.5 flex items-center gap-2 text-xs text-[var(--nsfw-contextual)]">
              <NsfwInterestIcon kind="contextual" />
              Si encaja · {{ contextual.length }}
            </p>
            <div class="custom-pills">
              <button
                v-for="label in contextual"
                :key="`c-${label}`"
                type="button"
                class="pill contextual !min-h-8 !py-1 !text-xs"
                @click="clearClassification(label)"
              >
                {{ label }} ×
              </button>
              <span v-if="!contextual.length" class="text-xs text-[var(--nsfw-dim)]">Ninguno.</span>
            </div>
          </div>

          <p class="mb-6 text-xs leading-relaxed text-[var(--nsfw-dim)]">
            Valoraciones del Hub: {{ ratingsCount }}. «De las que me gustan» se activa con
            {{ minTaste }}+ ({{ tasteUnlocked ? 'activa' : 'aún no' }}).
          </p>

          <div class="flex-1" />

          <button type="submit" class="nsfw-btn-primary min-h-13 w-full">Guardar</button>
        </aside>
      </div>
    </section>
  </form>
</template>
