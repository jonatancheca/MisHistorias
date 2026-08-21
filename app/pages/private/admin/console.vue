<script setup lang="ts">
definePageMeta({ layout: 'private' })

const auth = useNsfwAuthStore()
if (!auth.isAdmin) {
  await navigateTo('/private')
}

type ConsoleData = {
  taxonomy?: {
    approved: Array<Record<string, unknown>>
    proposed: Array<Record<string, unknown>>
    discarded: Array<Record<string, unknown>>
  }
  privateCandidates?: Array<{
    label: string
    kind: string
    userCount: number
    sampleUserIds: string[]
  }>
  feedback?: Array<Record<string, unknown>>
  generations?: Array<Record<string, unknown>>
  publications?: Array<Record<string, unknown>>
  comments?: Array<Record<string, unknown>>
}

const data = ref<ConsoleData>({})
const message = ref<string | null>(null)

async function refresh() {
  data.value = await $fetch<ConsoleData>('/api/private/admin/console')
}

await refresh()

async function setTerm(termId: string, status: 'approved' | 'discarded') {
  await $fetch('/api/private/admin/console', {
    method: 'POST',
    body: { action: 'taxonomy', termId, status }
  })
  message.value = `Término ${status}`
  await refresh()
}

async function promotePrivate(label: string, kind: string) {
  const result = await $fetch<{
    term: { label: string }
    created: boolean
    removedPrivate: number
  }>('/api/private/admin/console', {
    method: 'POST',
    body: { action: 'promote-private', label, kind }
  })
  message.value = result.created
    ? `«${result.term.label}» promovido a público (${result.removedPrivate} privados eliminados)`
    : `«${result.term.label}» ya era público`
  await refresh()
}

async function withdraw(publicationId: string) {
  await $fetch('/api/private/admin/console', {
    method: 'POST',
    body: { action: 'withdraw', publicationId }
  })
  message.value = 'Publicación retirada'
  await refresh()
}
</script>

<template>
  <div class="nsfw-page mx-auto max-w-5xl px-4 py-8 sm:px-6">
    <header class="mb-6">
      <h1 class="font-serif text-3xl">Consola admin</h1>
      <p class="text-sm text-[var(--nsfw-muted)]">
        Taxonomía, feedback, publicaciones y generaciones sin prosa.
      </p>
    </header>
    <p v-if="message" class="mb-4 text-sm text-[var(--nsfw-success)]">{{ message }}</p>

    <section class="nsfw-card mb-6">
      <h2 class="mb-3 text-lg">Taxonomía propuesta</h2>
      <ul class="grid gap-2">
        <li
          v-for="term in data.taxonomy?.proposed || []"
          :key="String(term.id)"
          class="flex flex-wrap items-center gap-2 border-b border-[var(--nsfw-line)] py-2"
        >
          <span class="flex-1">{{ term.label }} · {{ term.kind }}</span>
          <button type="button" class="nsfw-btn-ghost" @click="setTerm(String(term.id), 'approved')">
            Aprobar
          </button>
          <button type="button" class="nsfw-btn-ghost" @click="setTerm(String(term.id), 'discarded')">
            Descartar
          </button>
        </li>
        <li v-if="!(data.taxonomy?.proposed || []).length" class="text-sm text-[var(--nsfw-muted)]">
          Sin propuestas.
        </li>
      </ul>
    </section>

    <section class="nsfw-card mb-6">
      <h2 class="mb-3 text-lg">Privados candidatos a público</h2>
      <p class="mb-3 text-sm text-[var(--nsfw-muted)]">
        Lista deduplicada de etiquetas privadas que aún no existen como término público aprobado.
        Al promover, se crea el público y se eliminan los privados homónimos.
      </p>
      <ul class="grid gap-2">
        <li
          v-for="term in data.privateCandidates || []"
          :key="term.label"
          class="flex flex-wrap items-center gap-2 border-b border-[var(--nsfw-line)] py-2"
        >
          <span class="flex-1">
            {{ term.label }}
            <span class="text-sm text-[var(--nsfw-muted)]">
              · {{ term.kind }} · {{ term.userCount }} usuario(s)
            </span>
          </span>
          <button
            type="button"
            class="nsfw-btn-ghost"
            @click="promotePrivate(term.label, term.kind)"
          >
            Promover a público
          </button>
        </li>
        <li v-if="!(data.privateCandidates || []).length" class="text-sm text-[var(--nsfw-muted)]">
          Sin candidatos.
        </li>
      </ul>
    </section>

    <section class="nsfw-card mb-6">
      <h2 class="mb-3 text-lg">Publicaciones</h2>
      <ul class="grid gap-2">
        <li
          v-for="item in data.publications || []"
          :key="String(item.id)"
          class="flex flex-wrap items-center gap-2 border-b border-[var(--nsfw-line)] py-2"
        >
          <div class="min-w-0 flex-1">
            <p>{{ item.title }} · {{ item.username }}</p>
            <p class="text-xs text-[var(--nsfw-faint)]">{{ item.resource_type }} · {{ item.status }}</p>
          </div>
          <button
            v-if="item.status === 'published'"
            type="button"
            class="nsfw-btn-ghost"
            @click="withdraw(String(item.id))"
          >
            Retirar
          </button>
        </li>
      </ul>
    </section>

    <section class="nsfw-card mb-6">
      <h2 class="mb-3 text-lg">Generaciones (metadatos)</h2>
      <ul class="grid gap-2 text-sm">
        <li
          v-for="item in data.generations || []"
          :key="String(item.attemptId)"
          class="border-b border-[var(--nsfw-line)] py-2"
        >
          <p>
            {{ item.username }} · {{ item.format }} · {{ item.generationProfile }} ·
            {{ item.modelAlias }} · {{ item.state }} · {{ item.latencyMs }}ms
          </p>
          <p class="text-xs text-[var(--nsfw-faint)]">
            tokens {{ item.usage?.totalTokens ?? 0 }} · sin prosa
          </p>
        </li>
      </ul>
    </section>

    <section class="nsfw-card">
      <h2 class="mb-3 text-lg">Feedback</h2>
      <ul class="grid gap-2 text-sm">
        <li
          v-for="item in data.feedback || []"
          :key="String(item.id)"
          class="border-b border-[var(--nsfw-line)] py-2"
        >
          <p>{{ item.kind }} · score {{ item.score ?? '—' }}</p>
          <p class="text-[var(--nsfw-muted)]">{{ item.body || '(sin texto)' }}</p>
        </li>
      </ul>
    </section>
  </div>
</template>
