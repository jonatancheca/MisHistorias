<script setup lang="ts">
import type { LlmDebugTrace } from '#shared/types'

const props = defineProps<{ trace: LlmDebugTrace; editable?: boolean }>()
const emit = defineEmits<{ inspect: [trace: LlmDebugTrace]; remove: [trace: LlmDebugTrace] }>()
const applied = computed(() => props.trace.status === 'success' && props.trace.request.compaction?.applied !== false)
const characters = (messages: Array<{ content: string }>) => messages.reduce((total, message) => total + message.content.length, 0)
</script>

<template>
  <div
    data-testid="story-compaction-marker"
    :data-compaction-trace-id="trace.id"
    class="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-sm"
  >
    <div class="min-w-0">
      <p class="font-semibold">{{ applied ? 'Historial compactado' : 'Compactación fallida' }}</p>
      <p v-if="trace.request.compaction" class="text-xs opacity-80">
        {{ trace.request.compaction.beforeUsage?.count ?? characters(trace.request.compaction.before) }} {{ trace.request.compaction.beforeUsage?.unit === 'tokens' ? 'tokens' : 'caracteres' }} antes
        <template v-if="trace.request.compaction.after"> · {{ trace.request.compaction.afterUsage?.count ?? characters(trace.request.compaction.after) }} después</template>
      </p>
    </div>
    <div class="flex flex-wrap gap-1">
      <button type="button" class="btn-ghost shrink-0 px-2 py-1 text-xs" @click="emit('inspect', trace)">
        Ver antes / después
      </button>
      <button
        v-if="editable"
        type="button"
        class="btn-danger shrink-0 px-2 py-1 text-xs"
        aria-label="Borrar compactación"
        @click="emit('remove', trace)"
      >
        Borrar
      </button>
    </div>
  </div>
</template>
