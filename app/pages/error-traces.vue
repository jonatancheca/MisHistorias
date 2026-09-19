<script setup lang="ts">
import type {
  ErrorTrace,
  ErrorTraceListResponse,
  ErrorTraceSource
} from '#shared/types'
import { clearErrorTraces, listErrorTraces } from '~/lib/errorTraces'

const access = useAccessStore()
const confirmDialog = useConfirmStore()
await access.load()
if (access.session.multiUserEnabled && !access.session.isAdmin) {
  await navigateTo('/settings')
}

const result = ref<ErrorTraceListResponse>({
  items: [], total: 0, limit: 50, offset: 0, sources: [], users: []
})
const loading = ref(false)
const clearing = ref(false)
const error = ref('')
const selected = ref<ErrorTrace | null>(null)
const source = ref<ErrorTraceSource | ''>('')
const owner = ref('')
const scope = ref<'' | 'normal' | 'private'>('')
const page = ref(0)

const sourceLabels: Record<ErrorTraceSource, string> = {
  llm: 'LLM',
  swarmui: 'SwarmUI',
  backup: 'Backups',
  update: 'Actualizaciones',
  sqlite: 'SQLite',
  server: 'Servidor',
  client: 'Navegador'
}

const totalPages = computed(() => Math.max(1, Math.ceil(result.value.total / result.value.limit)))

function errorMessage(caught: unknown) {
  const value = caught as { data?: { message?: string; statusMessage?: string }; message?: string }
  return value.data?.message || value.data?.statusMessage || value.message || 'No se pudieron cargar las trazas.'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    result.value = await listErrorTraces({
      ...(source.value ? { source: source.value } : {}),
      ...(owner.value ? { owner: owner.value } : {}),
      ...(scope.value ? { scope: scope.value } : {}),
      limit: 50,
      offset: page.value * 50
    })
    if (page.value > 0 && !result.value.items.length && result.value.total) {
      page.value = Math.max(0, totalPages.value - 1)
      await load()
    }
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

async function clearAll() {
  const accepted = await confirmDialog.ask({
    title: 'Borrar todas las trazas',
    message: 'Se borrarán definitivamente todas las trazas de error activas. Los backups SQLite anteriores seguirán conservándolas.',
    confirmLabel: 'Borrar todas'
  })
  if (!accepted) return
  clearing.value = true
  error.value = ''
  try {
    await clearErrorTraces()
    selected.value = null
    page.value = 0
    await load()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    clearing.value = false
  }
}

function changeFilters() {
  page.value = 0
  void load()
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date(value))
}

function userLabel(trace: ErrorTrace) {
  return trace.ownerEmail || trace.ownerId || 'Usuario único'
}

onMounted(load)
</script>

<template>
  <div class="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
    <header class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0">
        <NuxtLink to="/settings#datos" class="text-sm font-semibold text-brand-600">
          ← Volver a Ajustes
        </NuxtLink>
        <h1 class="mt-2 text-3xl font-bold tracking-tight">Trazas de error</h1>
        <p class="mt-2 max-w-3xl text-sm text-[var(--color-fg-muted)]">
          Registro operativo de fallos. Las llamadas y respuestas se guardan sin sanear y pueden contener contenido privado o secretos.
        </p>
      </div>
      <button
        type="button"
        class="btn-danger shrink-0"
        :disabled="clearing || result.total === 0"
        @click="clearAll"
      >
        {{ clearing ? 'Borrando…' : 'Borrar todas' }}
      </button>
    </header>

    <section class="mt-6 grid gap-3 rounded-2xl border border-[var(--color-border-soft)] p-4 sm:grid-cols-3">
      <label class="min-w-0 text-sm font-semibold">
        Origen
        <select v-model="source" class="field mt-1" @change="changeFilters">
          <option value="">Todos</option>
          <option v-for="item in result.sources" :key="item" :value="item">
            {{ sourceLabels[item] }}
          </option>
        </select>
      </label>
      <label class="min-w-0 text-sm font-semibold">
        Usuario
        <select v-model="owner" class="field mt-1" @change="changeFilters">
          <option value="">Todos</option>
          <option
            v-for="item in result.users"
            :key="item.ownerId ?? '__single__'"
            :value="item.ownerId ?? '__single__'"
          >
            {{ item.ownerEmail || item.ownerId || 'Usuario único' }}
          </option>
        </select>
      </label>
      <label class="min-w-0 text-sm font-semibold">
        Ámbito
        <select v-model="scope" class="field mt-1" @change="changeFilters">
          <option value="">Todos</option>
          <option value="normal">Normal</option>
          <option value="private">Privado</option>
        </select>
      </label>
    </section>

    <p v-if="error" class="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-600" role="alert">
      {{ error }}
    </p>
    <p v-else-if="loading" class="mt-6 text-sm text-[var(--color-fg-muted)]">Cargando trazas…</p>
    <p v-else-if="!result.items.length" class="mt-6 rounded-2xl border border-dashed border-[var(--color-border-soft)] p-8 text-center text-sm text-[var(--color-fg-muted)]">
      No hay trazas para estos filtros.
    </p>

    <ol v-else class="mt-6 space-y-3" data-testid="error-trace-list">
      <li v-for="trace in result.items" :key="trace.id">
        <button
          type="button"
          class="w-full min-w-0 rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-4 text-left transition hover:border-brand-500/50 hover:bg-brand-500/5"
          @click="selected = trace"
        >
          <span class="flex min-w-0 flex-wrap items-center gap-2">
            <span class="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-600">
              {{ sourceLabels[trace.source] }}
            </span>
            <span class="rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/5">
              {{ trace.scope || 'global' }}
            </span>
            <span v-if="trace.status" class="text-xs text-[var(--color-fg-muted)]">HTTP {{ trace.status }}</span>
            <time class="text-xs text-[var(--color-fg-muted)] sm:ml-auto">{{ formatDate(trace.createdAt) }}</time>
          </span>
          <strong class="mt-2 block break-words text-sm">{{ trace.message }}</strong>
          <span class="mt-1 block break-all text-xs text-[var(--color-fg-muted)]">
            {{ trace.operation }} · {{ userLabel(trace) }}
          </span>
        </button>
      </li>
    </ol>

    <nav v-if="result.total > result.limit" class="mt-6 flex items-center justify-between gap-3" aria-label="Paginación de trazas">
      <button type="button" class="btn-ghost" :disabled="page === 0 || loading" @click="page--; load()">
        Anterior
      </button>
      <span class="text-sm text-[var(--color-fg-muted)]">Página {{ page + 1 }} de {{ totalPages }}</span>
      <button type="button" class="btn-ghost" :disabled="page + 1 >= totalPages || loading" @click="page++; load()">
        Siguiente
      </button>
    </nav>

    <ErrorTraceDialog :trace="selected" @close="selected = null" />
  </div>
</template>
