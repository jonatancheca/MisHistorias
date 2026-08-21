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
  if (!modelAlias.value) modelAlias.value = current.modelAlias
  generationProfile.value = current.generationProfile
})

const beats = computed(() => sessions.play?.beats ?? [])
const attempt = computed(() => sessions.play?.activeAttempt ?? null)
const session = computed(() => sessions.play?.session ?? null)

function actorName(actorId: string) {
  return session.value?.cast.find((member) => member.actorId === actorId)?.name || actorId
}

async function submit(kind: PlayerInput['kind'] = inputKind.value, text = draft.value) {
  localError.value = null
  if (!session.value) return
  if (attempt.value && ['ready', 'streaming', 'validating'].includes(attempt.value.state)) {
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
    <header>
      <p class="text-xs uppercase tracking-[0.2em] text-[var(--nsfw-faint)]">Chat</p>
      <h1 class="text-2xl font-medium">{{ session?.title }}</h1>
      <p class="mt-2 text-sm text-[var(--nsfw-muted)]">
        Historia privada · formato inmutable Chat
      </p>
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
        v-if="attempt && ['streaming', 'validating', 'ready'].includes(attempt.state)"
        class="rounded-xl border border-dashed border-[var(--nsfw-line)] p-3 text-sm text-[var(--nsfw-muted)]"
        aria-live="polite"
      >
        <p class="mb-1 text-xs uppercase text-[var(--nsfw-faint)]">
          {{ attempt.state === 'ready' ? 'Listo' : 'Provisional' }}
        </p>
        <p class="whitespace-pre-wrap">{{ attempt.provisionalText }}</p>
      </div>
    </div>

    <p v-if="localError" class="text-sm text-[var(--nsfw-danger)]">{{ localError }}</p>

    <div v-if="attempt?.state === 'ready'" class="flex gap-2">
      <button type="button" class="nsfw-btn-primary" @click="sessions.accept(sessionId, attempt.id)">
        Aceptar
      </button>
      <button type="button" class="nsfw-btn-ghost" @click="sessions.discard(sessionId, attempt.id)">
        Descartar
      </button>
      <button
        type="button"
        class="nsfw-btn-ghost"
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
      <div class="flex flex-wrap gap-2">
        <button type="button" class="nsfw-btn-ghost" @click="inputKind = 'speak'">Speak</button>
        <button type="button" class="nsfw-btn-ghost" @click="inputKind = 'act'">Act</button>
        <button type="button" class="nsfw-btn-ghost" @click="submit('continue', '')">Continuar</button>
      </div>
      <input
        v-model="draft"
        class="nsfw-input w-full"
        :placeholder="inputKind === 'speak' ? 'Dices…' : 'Haces…'"
        @keydown.enter.prevent="submit()"
      >
      <button type="button" class="nsfw-btn-primary" :disabled="sessions.loading" @click="submit()">
        Enviar
      </button>
    </section>
  </div>
</template>
