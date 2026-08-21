<script setup lang="ts">
const props = defineProps<{
  sessionId?: string
  attemptId?: string | null
  beatCount?: number
}>()

const open = ref(false)
const kind = ref<'bug' | 'suggestion' | 'survey'>('suggestion')
const body = ref('')
const score = ref(4)
const sent = ref<string | null>(null)

const showCheckpoint = computed(() => (props.beatCount || 0) > 0 && (props.beatCount || 0) % 10 === 0)

async function send(payload: Record<string, unknown>) {
  await $fetch('/api/private/feedback', { method: 'POST', body: payload })
  sent.value = 'Gracias'
  body.value = ''
  open.value = false
}

async function thumb(value: 'up' | 'down') {
  if (!props.attemptId || !props.sessionId) return
  await $fetch(`/api/private/sessions/${props.sessionId}/attempts/${props.attemptId}/thumb`, {
    method: 'POST',
    body: { thumb: value }
  })
  sent.value = value === 'up' ? '👍' : '👎'
}

async function submit() {
  await send({
    kind: kind.value,
    body: body.value,
    score: kind.value === 'survey' ? score.value : null,
    sessionId: props.sessionId,
    attemptId: props.attemptId
  })
}

async function checkpoint(value: number) {
  await send({
    kind: 'checkpoint',
    score: value,
    sessionId: props.sessionId,
    body: 'checkpoint'
  })
}
</script>

<template>
  <div class="space-y-2 text-sm">
    <div class="flex flex-wrap items-center gap-2">
      <button
        v-if="attemptId"
        type="button"
        class="nsfw-btn-ghost"
        title="Me gusta"
        @click="thumb('up')"
      >
        ↑
      </button>
      <button
        v-if="attemptId"
        type="button"
        class="nsfw-btn-ghost"
        title="No me gusta"
        @click="thumb('down')"
      >
        ↓
      </button>
      <button type="button" class="nsfw-btn-ghost" @click="open = !open">Feedback</button>
      <span class="text-xs text-[var(--nsfw-faint)]">Audio: Próximamente</span>
      <span v-if="sent" class="text-xs text-[var(--nsfw-success)]">{{ sent }}</span>
    </div>

    <div v-if="showCheckpoint" class="nsfw-card flex flex-wrap items-center gap-2">
      <span class="text-[var(--nsfw-muted)]">¿Cómo va? (≈1/10 beats)</span>
      <button
        v-for="n in 5"
        :key="n"
        type="button"
        class="nsfw-btn-ghost"
        @click="checkpoint(n)"
      >
        {{ n }}
      </button>
    </div>

    <form v-if="open" class="nsfw-card space-y-2" @submit.prevent="submit">
      <select v-model="kind" class="nsfw-input w-full">
        <option value="suggestion">Sugerencia</option>
        <option value="bug">Bug</option>
        <option value="survey">Encuesta final</option>
      </select>
      <input
        v-if="kind === 'survey'"
        v-model.number="score"
        type="number"
        min="1"
        max="5"
        class="nsfw-input w-full"
      >
      <textarea v-model="body" class="nsfw-input min-h-20 w-full" placeholder="Opcional" />
      <button type="submit" class="nsfw-btn-primary">Enviar</button>
    </form>
  </div>
</template>
