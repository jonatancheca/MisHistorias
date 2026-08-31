<script setup lang="ts">
import type { StorySwarmError } from '#shared/types'

const props = defineProps<{ error: StorySwarmError }>()
const copyNotice = ref('')
const requestJson = computed(() => JSON.stringify(props.error.call.generation?.request ?? props.error.call.request, null, 2))
const generationSent = computed(() => props.error.call.generation?.requestSent ?? props.error.call.requestSent)
const responseText = computed(() => typeof props.error.call.response?.body === 'string'
  ? props.error.call.response.body
  : JSON.stringify(props.error.call.response?.body ?? null, null, 2))

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copyNotice.value = 'Copiado.'
  } catch {
    copyNotice.value = 'No se pudo copiar. Selecciona el texto para copiarlo manualmente.'
  }
}
</script>

<template>
  <section data-testid="swarm-error-message" class="min-w-0 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
    <p class="font-semibold [overflow-wrap:anywhere]">Error de SwarmUI · {{ error.characterName }}</p>
    <p class="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{{ error.call.message }}</p>
    <details class="mt-2 min-w-0">
      <summary class="cursor-pointer font-medium">Detalles de SwarmUI</summary>
      <p class="mt-2 [overflow-wrap:anywhere]">
        {{ error.call.target === 'swarm' ? 'SwarmUI' : 'Proxy de Mis Historias' }} · {{ error.call.operation }}
        <span v-if="error.call.response" class="whitespace-nowrap"> · HTTP {{ error.call.response.status }}</span>
      </p>
      <p v-if="error.call.requestSent !== true" class="mt-1">
        {{ error.call.requestSent === false ? 'La petición no llegó a enviarse.' : 'Sin confirmación de recepción de la petición.' }}
      </p>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <h3 class="font-medium">{{ generationSent === false ? 'JSON preparado (no enviado)' : 'JSON enviado' }}</h3>
        <button type="button" class="btn-ghost px-2 py-1 text-xs" aria-label="Copiar JSON enviado a SwarmUI" @click="copy(requestJson)">Copiar</button>
      </div>
      <pre class="mt-1 max-h-72 max-w-full overflow-auto rounded-lg bg-black/5 p-2 text-xs whitespace-pre-wrap break-all dark:bg-white/5">{{ requestJson }}</pre>
      <template v-if="error.call.generation">
        <p class="mt-2">Petición de la operación fallida:</p>
        <pre class="mt-1 max-h-72 max-w-full overflow-auto text-xs whitespace-pre-wrap break-all">{{ JSON.stringify(error.call.request, null, 2) }}</pre>
      </template>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <h3 class="font-medium">Respuesta</h3>
        <button type="button" class="btn-ghost px-2 py-1 text-xs" aria-label="Copiar respuesta de SwarmUI" @click="copy(responseText)">Copiar</button>
      </div>
      <pre v-if="error.call.response" class="mt-1 max-h-72 max-w-full overflow-auto rounded-lg bg-black/5 p-2 text-xs whitespace-pre-wrap break-all dark:bg-white/5">{{ responseText }}</pre>
      <p v-else class="mt-1">No se recibió respuesta HTTP.</p>
      <p v-if="copyNotice" class="mt-2" role="status">{{ copyNotice }}</p>
    </details>
  </section>
</template>
