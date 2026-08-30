<script setup lang="ts">
import type { ImageGenerationMetadata } from '#shared/types'

const props = defineProps<{ generation: ImageGenerationMetadata }>()
const notice = ref('')

const entries = computed(() => [
  ['Semilla', props.generation.seed],
  ...(props.generation.variationSeed !== undefined
    ? [['Variación de semilla', props.generation.variationSeed], ['Fuerza de variación', props.generation.variationSeedStrength ?? 0.5]]
    : []),
  ...(props.generation.lora ? [['LoRA', props.generation.lora]] : []),
  ...(props.generation.model ? [['Modelo', props.generation.model]] : []),
  ...(props.generation.preset ? [['Preset', props.generation.preset]] : []),
  ...(props.generation.prompt ? [['Prompt', props.generation.prompt]] : [])
] as Array<[string, string | number]>)

async function copy(value: string | number) {
  try {
    await navigator.clipboard.writeText(String(value))
    notice.value = 'Copiado'
  } catch {
    notice.value = 'No se pudo copiar'
  }
}

async function copyAll() {
  await copy(entries.value.map(([label, value]) => `${label}: ${value}`).join('\n'))
}
</script>

<template>
  <div class="grid gap-3" data-testid="image-generation-metadata">
    <div class="flex items-center justify-between gap-2">
      <h3 class="font-semibold">Metadatos de IA</h3>
      <button type="button" class="btn-ghost px-2 py-1 text-xs" @click="copyAll">Copiar todo</button>
    </div>
    <dl class="grid gap-2 text-sm">
      <div v-for="([label, value]) in entries" :key="label" class="min-w-0">
        <dt class="text-xs text-[var(--color-fg-muted)]">{{ label }}</dt>
        <dd class="flex min-w-0 items-start gap-2">
          <code class="min-w-0 flex-1 select-text break-words whitespace-pre-wrap">{{ value }}</code>
          <button type="button" class="btn-ghost shrink-0 px-2 py-1 text-xs" @click="copy(value)">Copiar</button>
        </dd>
      </div>
    </dl>
    <p v-if="notice" class="text-xs" :class="notice === 'Copiado' ? 'text-green-600' : 'text-red-500'" role="status">
      {{ notice }}
    </p>
  </div>
</template>
