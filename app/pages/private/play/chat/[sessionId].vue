<script setup lang="ts">
import type { GenerationProfile, PlayerInput } from '../../../../../shared/types/nsfw/session.ts'

definePageMeta({ layout: 'private' })

const route = useRoute()
const sessions = useNsfwSessionsStore()
const sessionId = computed(() => String(route.params.sessionId || ''))
const draft = ref('')
const inputKind = ref<'speak' | 'act' | 'free'>('free')
const modelAlias = ref('')
const generationProfile = ref<GenerationProfile>('quick')
const localError = ref<string | null>(null)

await sessions.loadModels()
await sessions.loadPlay(sessionId.value)

watchEffect(() => {
  const current = sessions.play?.session
  if (!current) return
  if (current.format !== 'chat') {
    void navigateTo(`/private/play/${current.format === 'vn' ? 'vn' : 'story'}/${current.id}`)
  }
})

watch(
  () => sessions.play?.session,
  (current) => {
    if (!current) return
    modelAlias.value = current.modelAlias
    generationProfile.value = current.generationProfile
  },
  { immediate: true }
)

const beats = computed(() => sessions.play?.beats ?? [])
const attempt = computed(() => sessions.play?.activeAttempt ?? null)
const session = computed(() => sessions.play?.session ?? null)
const busy = computed(
  () =>
    sessions.loading ||
    Boolean(attempt.value && ['requested', 'streaming', 'validating'].includes(attempt.value.state))
)

function actorName(actorId: string) {
  return session.value?.cast.find((member) => member.actorId === actorId)?.name || actorId
}

function looksLikeJson(value: string) {
  const trimmed = value.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('```') || trimmed.startsWith('[')
}

async function submit(kind: PlayerInput['kind'] = inputKind.value, text = draft.value) {
  localError.value = null
  if (!session.value || busy.value) return
  if (attempt.value && ['ready', 'streaming', 'validating', 'requested'].includes(attempt.value.state)) {
    localError.value = 'Hay una generación pendiente'
    return
  }
  try {
    await sessions.generate(sessionId.value, {
      input: { kind, text: text.trim() },
      modelAlias: modelAlias.value || session.value.modelAlias,
      generationProfile: generationProfile.value
    })
    draft.value = ''
  } catch (caught) {
    localError.value = (caught as Error).message || 'Error'
  }
}
</script>

<template>
  <div class="nsfw-page mx-auto flex w-full max-w-[48rem] flex-col gap-4 px-4 py-6">
    <header class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-xs uppercase tracking-[0.2em] text-[var(--nsfw-faint)]">Chat</p>
        <h1 class="text-2xl font-medium">{{ session?.title }}</h1>
      </div>
      <NsfwSessionSheet :session-id="sessionId" />
    </header>

    <div class="nsfw-card flex min-h-[50vh] flex-col gap-3">
      <template v-for="beat in beats" :key="beat.id">
        <div
          v-for="(unit, index) in beat.envelope.visibleUnits"
          :key="`${beat.id}-${index}`"
          class="flex gap-3"
        >
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--nsfw-soft)] text-xs text-[var(--nsfw-gold)]"
          >
            {{ unit.type === 'dialogue' ? actorName(unit.actorId).slice(0, 2) : '··' }}
          </div>
          <div class="min-w-0 flex-1">
            <p v-if="unit.type === 'dialogue'" class="text-xs text-[var(--nsfw-gold)]">
              {{ actorName(unit.actorId) }}
            </p>
            <p
              class="text-sm leading-relaxed"
              :class="unit.type === 'narration' ? 'italic text-[var(--nsfw-muted)]' : ''"
            >
              {{ unit.text }}
            </p>
          </div>
        </div>
      </template>

      <div
        v-if="busy || (attempt && ['streaming', 'validating', 'ready'].includes(attempt.state))"
        class="rounded-xl border border-dashed border-[var(--nsfw-line)] p-3 text-sm text-[var(--nsfw-muted)]"
        aria-live="polite"
      >
        <p class="mb-1 text-xs uppercase text-[var(--nsfw-faint)]">
          <template v-if="busy && attempt?.state !== 'ready'">Generando…</template>
          <template v-else-if="attempt?.state === 'ready'">Listo</template>
          <template v-else>Provisional</template>
        </p>
        <p v-if="busy && (!attempt?.provisionalText || looksLikeJson(attempt.provisionalText))" class="nsfw-loading-pulse">
          Esperando respuesta del modelo…
        </p>
        <p
          v-else-if="attempt?.provisionalText && !looksLikeJson(attempt.provisionalText)"
          class="whitespace-pre-wrap"
        >
          {{ attempt.provisionalText }}
        </p>
      </div>
    </div>

    <p v-if="attempt?.state === 'failed'" class="text-sm text-[var(--nsfw-danger)]">
      {{ attempt.errorMessage || 'Falló la generación' }}
    </p>
    <p v-if="localError" class="text-sm text-[var(--nsfw-danger)]">{{ localError }}</p>

    <div v-if="attempt?.state === 'ready'" class="flex gap-2">
      <button
        type="button"
        class="nsfw-btn-primary"
        :disabled="busy"
        @click="sessions.accept(sessionId, attempt.id)"
      >
        Aceptar
      </button>
      <button
        type="button"
        class="nsfw-btn-ghost"
        :disabled="busy"
        @click="sessions.discard(sessionId, attempt.id)"
      >
        Descartar
      </button>
      <button
        type="button"
        class="nsfw-btn-ghost"
        :disabled="busy"
        @click="sessions.reroll(sessionId, attempt.id, { modelAlias, generationProfile })"
      >
        Re-roll
      </button>
    </div>

    <NsfwFeedbackStrip
      :session-id="sessionId"
      :attempt-id="attempt?.id"
      :beat-count="beats.length"
    />
    <NsfwAudioAffordances />

    <section class="nsfw-card space-y-3">
      <details>
        <summary class="cursor-pointer list-none text-xs uppercase tracking-[0.14em] text-[var(--nsfw-faint)]">
          Modelo · perfil
          <span class="ml-2 normal-case tracking-normal text-[var(--nsfw-muted)]">
            {{ modelAlias || '—' }} · {{ generationProfile }}
          </span>
        </summary>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="mb-1 block text-xs text-[var(--nsfw-faint)]">Modelo</span>
            <select v-model="modelAlias" class="nsfw-input w-full">
              <option v-for="model in sessions.models" :key="model.alias" :value="model.alias">
                {{ model.alias }}
              </option>
            </select>
            <small class="mt-1 block break-all text-[10px] text-[var(--nsfw-faint)]">
              LM Studio id:
              {{
                sessions.models.find((item) => item.alias === modelAlias)?.lmStudioModelId ||
                  session?.modelAlias ||
                  '—'
              }}
            </small>
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-[var(--nsfw-faint)]">Perfil</span>
            <select v-model="generationProfile" class="nsfw-input w-full">
              <option value="quick">Quick</option>
              <option value="quality">Quality</option>
            </select>
          </label>
        </div>
      </details>

      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="nsfw-btn-ghost"
          :class="inputKind === 'speak' ? 'text-[var(--nsfw-accent)]' : ''"
          :disabled="busy"
          @click="inputKind = 'speak'"
        >
          Speak
        </button>
        <button
          type="button"
          class="nsfw-btn-ghost"
          :class="inputKind === 'act' ? 'text-[var(--nsfw-accent)]' : ''"
          :disabled="busy"
          @click="inputKind = 'act'"
        >
          Act
        </button>
        <button
          type="button"
          class="nsfw-btn-ghost"
          :disabled="busy"
          @click="submit('continue', '')"
        >
          Continuar
        </button>
      </div>
      <input
        v-model="draft"
        class="nsfw-input w-full"
        :disabled="busy"
        :placeholder="inputKind === 'speak' ? 'Dices…' : 'Haces…'"
        @keydown.enter.prevent="submit()"
      >
      <button type="button" class="nsfw-btn-primary" :disabled="busy" @click="submit()">
        {{ busy ? 'Generando…' : 'Enviar' }}
      </button>
    </section>
  </div>
</template>
