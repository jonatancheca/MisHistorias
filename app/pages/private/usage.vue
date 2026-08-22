<script setup lang="ts">
import { relativeTime } from '../../lib/relativeTime.ts'

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

const cards = computed(() => [
  {
    label: 'Rápido p50',
    value: latency.value.quick.p50Ms,
    target: latency.value.targets.quickP50Ms,
    count: latency.value.quick.count,
    p95: latency.value.quick.p95Ms
  },
  {
    label: 'Calidad p50',
    value: latency.value.quality.p50Ms,
    target: latency.value.targets.qualityP50Ms,
    count: latency.value.quality.count,
    p95: latency.value.quality.p95Ms
  }
])

function seconds(ms: number | null) {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`
}

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
  <div class="nsfw-page mx-auto max-w-[56rem] px-5 py-10 sm:px-12 sm:py-14">
    <header class="mb-9 flex flex-wrap items-end justify-between gap-5">
      <div>
        <h1 class="font-serif text-4xl">Uso y latencia</h1>
        <p class="mt-1 text-xs text-[var(--nsfw-faint)]">
          Tokens y latencia por intento, re-rolls y fallos incluidos. Sin cobro local.
        </p>
      </div>
      <button type="button" class="nsfw-btn-primary" :disabled="probing" @click="runProbe">
        {{ probing ? 'Midiendo…' : 'Medir ahora' }}
      </button>
    </header>

    <p class="nsfw-eyebrow nsfw-eyebrow--dim mb-3">Latencia medida</p>
    <div class="nsfw-hairgrid mb-4 sm:grid-cols-2">
      <div v-for="card in cards" :key="card.label" class="px-6 py-5">
        <p class="mb-1.5 text-xs text-[var(--nsfw-faint)]">{{ card.label }}</p>
        <p class="font-serif text-[1.9rem] leading-none">
          {{ seconds(card.value) }}
          <span
            class="font-sans text-sm"
            :class="
              card.value !== null && card.value <= card.target
                ? 'text-[var(--nsfw-success)]'
                : 'text-[var(--nsfw-gold)]'
            "
          >
            / {{ seconds(card.target) }}
          </span>
        </p>
        <p class="mt-2 text-[0.7rem] text-[var(--nsfw-dim)]">
          {{ card.count }} intento(s) · p95 {{ seconds(card.p95) }}
        </p>
      </div>
    </div>
    <p v-if="probeNote" class="mb-2 text-xs text-[var(--nsfw-muted)]">{{ probeNote }}</p>
    <p v-if="probeError" class="mb-2 text-xs text-[var(--nsfw-danger)]">{{ probeError }}</p>

    <div class="nsfw-section-head mt-10">
      <h3>Últimos intentos</h3>
      <span class="text-xs text-[var(--nsfw-dim)]">{{ usage.length }}</span>
    </div>

    <p v-if="usage.length === 0" class="py-8 text-sm text-[var(--nsfw-muted)]">Sin intentos aún.</p>

    <div v-for="row in usage" :key="row.attemptId" class="nsfw-row cursor-default">
      <span class="min-w-0 flex-1">
        <span class="nsfw-row-title block truncate">{{ row.title }}</span>
        <span class="nsfw-row-sub block">
          {{ row.generationProfile === 'quick' ? 'rápido' : 'calidad' }} · {{ row.modelAlias }} ·
          {{ row.state }}
          <template v-if="row.thumb"> · {{ row.thumb === 'up' ? '👍' : '👎' }}</template>
        </span>
      </span>
      <span class="nsfw-row-meta text-right">
        {{ (row.latencyMs / 1000).toFixed(1) }} s · {{ row.usage.totalTokens }} tk
        <span class="block text-[var(--nsfw-dim)]">{{ relativeTime(row.createdAt) }}</span>
      </span>
    </div>
  </div>
</template>
