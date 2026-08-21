<script setup lang="ts">
definePageMeta({ layout: 'private' })

type UsageRow = {
  attemptId: string
  title: string
  modelAlias: string
  generationProfile: string
  state: string
  latencyMs: number
  usage: { totalTokens: number; promptTokens: number; completionTokens: number }
  thumb: 'up' | 'down' | null
  createdAt: number
}

const probing = ref(false)
const probeNote = ref<string | null>(null)
const probeError = ref<string | null>(null)

const { usage } = await $fetch<{ usage: UsageRow[] }>('/api/private/usage')
const latency = ref(
  await $fetch<{
    quick: { count: number; p50Ms: number | null; p95Ms: number | null }
    quality: { count: number; p50Ms: number | null; p95Ms: number | null }
    targets: { quickP50Ms: number; qualityP50Ms: number }
  }>('/api/private/usage/latency')
)

async function runProbe() {
  probing.value = true
  probeError.value = null
  try {
    const result = await $fetch<{
      note: string
      results: Array<{ profile: string; latencyMs: number; state: string }>
    }>('/api/private/usage/latency-probe', { method: 'POST' })
    probeNote.value = `${result.note} · ${result.results
      .map((row) => `${row.profile}=${row.latencyMs}ms/${row.state}`)
      .join(' · ')}`
    latency.value = await $fetch('/api/private/usage/latency')
  } catch (caught) {
    probeError.value = (caught as Error).message || 'Probe fallido'
  } finally {
    probing.value = false
  }
}
</script>

<template>
  <div class="nsfw-page mx-auto max-w-4xl overflow-x-hidden px-3 py-8 sm:px-6">
    <header class="mb-6">
      <h1 class="font-serif text-3xl">Usage</h1>
      <p class="text-sm text-[var(--nsfw-muted)]">
        Tokens y latencia por intento. Incluye re-rolls y fallos. Sin cobro local.
      </p>
    </header>

    <section class="nsfw-card mb-6 grid gap-3 sm:grid-cols-2">
      <div>
        <p class="text-xs uppercase text-[var(--nsfw-faint)]">Quick p50</p>
        <p class="text-2xl">
          {{ latency.quick.p50Ms ?? '—' }}ms
          <span class="text-sm text-[var(--nsfw-muted)]">/ target {{ latency.targets.quickP50Ms }}</span>
        </p>
      </div>
      <div>
        <p class="text-xs uppercase text-[var(--nsfw-faint)]">Quality p50</p>
        <p class="text-2xl">
          {{ latency.quality.p50Ms ?? '—' }}ms
          <span class="text-sm text-[var(--nsfw-muted)]">/ target {{ latency.targets.qualityP50Ms }}</span>
        </p>
      </div>
      <div class="sm:col-span-2 flex flex-wrap items-center gap-2">
        <button type="button" class="nsfw-btn-primary" :disabled="probing" @click="runProbe">
          {{ probing ? 'Midiendo…' : 'Medir Quick/Quality ahora' }}
        </button>
        <p v-if="probeNote" class="text-xs text-[var(--nsfw-muted)]">{{ probeNote }}</p>
        <p v-if="probeError" class="text-xs text-[var(--nsfw-danger)]">{{ probeError }}</p>
      </div>
    </section>
    <p v-if="usage.length === 0" class="nsfw-card text-sm text-[var(--nsfw-muted)]">Sin intentos aún.</p>
    <ul class="grid gap-3">
      <li v-for="row in usage" :key="row.attemptId" class="nsfw-card text-sm">
        <p class="text-lg">{{ row.title }}</p>
        <p class="text-[var(--nsfw-muted)]">
          {{ row.generationProfile }} · {{ row.modelAlias }} · {{ row.state }} ·
          {{ row.latencyMs }}ms · {{ row.usage.totalTokens }} tok
          <span v-if="row.thumb"> · {{ row.thumb }}</span>
        </p>
      </li>
    </ul>
  </div>
</template>
