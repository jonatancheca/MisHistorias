<script setup lang="ts">
import type {
  GenerationProfile,
  PlayerInput,
  SessionSheetTab
} from '../../../../../shared/types/nsfw/session.ts'

definePageMeta({ layout: 'private' })

const route = useRoute()
const sessions = useNsfwSessionsStore()
const sessionId = computed(() => String(route.params.sessionId || ''))
const draft = ref('')
const inputKind = ref<'speak' | 'act' | 'free'>('speak')
const modelAlias = ref('')
const generationProfile = ref<GenerationProfile>('quick')
const localError = ref<string | null>(null)
const sheet = ref<{ openSheet: (tab?: SessionSheetTab) => void } | null>(null)

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

const protagonistId = computed(
  () => session.value?.cast.find((member) => member.isSelfInsert)?.actorId || 'protagonist'
)

const partner = computed(() => session.value?.cast.find((member) => !member.isSelfInsert) || null)

/** Un solo v-for con clave estable: los fragmentos anidados se descolocaban al aceptar un beat. */
const timeline = computed(() =>
  beats.value.flatMap((beat) =>
    beat.envelope.visibleUnits.map((unit, index) => ({ key: `${beat.id}:${index}`, unit }))
  )
)

const lastChoices = computed(() => {
  const last = beats.value[beats.value.length - 1]
  return last?.envelope.choices ?? []
})

const modelAvailable = computed(
  () => sessions.models.find((model) => model.alias === modelAlias.value)?.available ?? false
)

function actorName(actorId: string) {
  return session.value?.cast.find((member) => member.actorId === actorId)?.name || actorId
}

function looksLikeJson(value: string) {
  const trimmed = value.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('```') || trimmed.startsWith('[')
}

async function submit(kind: PlayerInput['kind'] = inputKind.value, text = draft.value, choiceId?: string) {
  localError.value = null
  if (!session.value || busy.value) return
  if (attempt.value && ['ready', 'streaming', 'validating', 'requested'].includes(attempt.value.state)) {
    localError.value = 'Hay una generación pendiente'
    return
  }
  try {
    await sessions.generate(sessionId.value, {
      input: { kind, text: text.trim(), choiceId },
      modelAlias: modelAlias.value || session.value.modelAlias,
      generationProfile: generationProfile.value
    })
    draft.value = ''
  } catch (caught) {
    localError.value = (caught as Error).message || 'Error'
  }
}

async function toggleHeart() {
  if (!session.value) return
  await $fetch(`/api/private/sessions/${sessionId.value}/escalation`, {
    method: 'POST',
    body: { value: !session.value.escalationHeart }
  })
  await sessions.loadPlay(sessionId.value)
}
</script>

<template>
  <div class="nsfw-page relative flex min-h-full flex-col">
    <div class="nsfw-topbar">
      <div class="flex min-w-0 items-center gap-3">
        <span class="nsfw-avatar is-gold h-8 w-8">{{ (partner?.name || '·').slice(0, 1) }}</span>
        <div class="min-w-0">
          <p class="truncate font-serif text-[1.05rem]">{{ partner?.name || session?.title }}</p>
          <p class="truncate text-[0.7rem] text-[var(--nsfw-dim)]">
            {{ session?.title }} · beat {{ beats.length }}
          </p>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button type="button" class="nsfw-btn-text" @click="sheet?.openSheet('bible')">
          Biblia
        </button>
        <button type="button" class="nsfw-btn-text" @click="sheet?.openSheet('direction')">
          Director
        </button>
        <button type="button" class="nsfw-btn-text" @click="sheet?.openSheet('usage')">
          <span
            class="h-1 w-1 rounded-full"
            :style="{ background: modelAvailable ? 'var(--nsfw-success)' : 'var(--nsfw-gold)' }"
          />
          {{ generationProfile === 'quick' ? 'rápido' : 'calidad' }}
        </button>
      </div>
    </div>

    <div class="flex-1 px-6 pt-2 pb-8">
      <div class="mx-auto flex max-w-3xl flex-col gap-5">
        <p v-if="!beats.length" class="text-center text-sm text-[var(--nsfw-muted)]">
          Todavía no hay nada. Habla, actúa o deja que empiece.
        </p>

        <div v-for="item in timeline" :key="item.key">
          <!-- Narración: centrada, en cursiva, sin caja. -->
          <p
            v-if="item.unit.type === 'narration'"
            class="mx-auto max-w-[46ch] text-center font-serif text-[1.05rem] italic leading-relaxed text-[var(--nsfw-faint)]"
          >
            {{ item.unit.text }}
          </p>

          <!-- Lo que dices tú: burbuja coral a la derecha. -->
          <div v-else-if="item.unit.actorId === protagonistId" class="flex justify-end">
            <p
              class="max-w-[34ch] rounded-[18px_18px_4px_18px] border border-[color-mix(in_srgb,var(--nsfw-accent)_20%,transparent)] bg-[color-mix(in_srgb,var(--nsfw-accent)_11%,transparent)] px-4 py-3 font-serif text-[1.05rem] leading-snug text-[var(--nsfw-ink)]"
            >
              {{ item.unit.text }}
            </p>
          </div>

          <!-- El personaje: avatar, nombre en oro y prosa desnuda. -->
          <div v-else class="flex gap-3.5">
            <span class="nsfw-avatar is-gold mt-0.5">{{ actorName(item.unit.actorId).slice(0, 1) }}</span>
            <div class="min-w-0 flex-1">
              <p class="nsfw-speaker">{{ actorName(item.unit.actorId) }}</p>
              <p class="font-serif text-[1.1rem] leading-relaxed text-[var(--nsfw-prose)]">
                {{ item.unit.text }}
              </p>
            </div>
          </div>
        </div>

        <div
          v-if="busy || (attempt && ['streaming', 'validating', 'ready'].includes(attempt.state))"
          class="flex gap-3.5"
          aria-live="polite"
        >
          <span class="nsfw-avatar mt-0.5 opacity-50" />
          <div class="min-w-0 flex-1">
            <p class="nsfw-eyebrow">
              <template v-if="busy && attempt?.state !== 'ready'">Generando…</template>
              <template v-else-if="attempt?.state === 'ready'">Listo</template>
              <template v-else>Provisional</template>
            </p>
            <div
              v-if="busy && (!attempt?.provisionalText || looksLikeJson(attempt.provisionalText))"
              class="nsfw-loading-pulse flex gap-1.5"
            >
              <span v-for="n in 3" :key="n" class="h-1.5 w-1.5 rounded-full bg-[var(--nsfw-faint)]" />
            </div>
            <p
              v-else-if="attempt?.provisionalText && !looksLikeJson(attempt.provisionalText)"
              class="whitespace-pre-wrap font-serif text-[1.1rem] leading-relaxed text-[var(--nsfw-prose)]"
            >
              {{ attempt.provisionalText }}
            </p>
          </div>
        </div>

        <p v-if="attempt?.state === 'failed'" class="text-sm text-[var(--nsfw-danger)]">
          {{ attempt.errorMessage || 'Falló la generación' }}
        </p>
        <p v-if="localError" class="text-sm text-[var(--nsfw-danger)]">{{ localError }}</p>

        <div class="mt-4 flex flex-col gap-4">
          <NsfwFeedbackStrip
            :session-id="sessionId"
            :attempt-id="attempt?.id"
            :beat-count="beats.length"
          />
          <NsfwAudioAffordances />
        </div>
      </div>
    </div>

    <div class="nsfw-dock">
      <div class="mx-auto max-w-3xl">
        <div v-if="attempt?.state === 'ready'" class="mb-3 flex flex-wrap items-center gap-4">
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
            class="nsfw-btn-text"
            :disabled="busy"
            @click="sessions.reroll(sessionId, attempt.id, { modelAlias, generationProfile })"
          >
            Otra versión
          </button>
          <button
            type="button"
            class="nsfw-btn-text"
            :disabled="busy"
            @click="sessions.discard(sessionId, attempt.id)"
          >
            Descartar
          </button>
        </div>

        <div v-else-if="lastChoices.length" class="mb-3 flex flex-wrap gap-2">
          <button
            v-for="choice in lastChoices"
            :key="choice.id"
            type="button"
            class="nsfw-choice"
            :class="choice.prominence === 'primary' ? 'is-primary' : ''"
            @click="submit(choice.kind === 'choice' ? 'choice' : choice.kind, choice.label, choice.id)"
          >
            {{ choice.label }}
          </button>
        </div>

        <div
          class="flex items-center gap-2.5 rounded-full border border-[var(--nsfw-line-strong)] bg-[color-mix(in_srgb,var(--nsfw-raised)_92%,transparent)] py-1.5 pr-1.5 pl-5 backdrop-blur"
        >
          <label class="min-w-0 flex-1">
            <span class="sr-only">Tu turno</span>
            <input
              v-model="draft"
              class="w-full border-0 bg-transparent font-serif text-[1.05rem] text-[var(--nsfw-ink)] outline-none placeholder:italic placeholder:text-[var(--nsfw-dim)]"
              :disabled="busy"
              :placeholder="inputKind === 'act' ? 'Haces…' : 'Dices…'"
              @keydown.enter.prevent="submit()"
            >
          </label>
          <button
            type="button"
            class="nsfw-btn-text shrink-0"
            :class="inputKind === 'act' ? '!text-[var(--nsfw-ink)]' : ''"
            :disabled="busy"
            @click="inputKind = inputKind === 'act' ? 'speak' : 'act'"
          >
            Actuar
          </button>
          <button
            type="button"
            class="nsfw-btn-text shrink-0"
            :disabled="busy"
            @click="submit('continue', '')"
          >
            Narrador
          </button>
          <button
            type="button"
            class="nsfw-heat-btn shrink-0"
            :aria-pressed="Boolean(session?.escalationHeart)"
            title="Subir la temperatura de la escena"
            @click="toggleHeart"
          >
            <span aria-hidden="true">♥</span>
          </button>
          <button
            type="button"
            class="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-[var(--nsfw-accent)] text-[var(--nsfw-canvas)] transition hover:brightness-110 disabled:opacity-50"
            :disabled="busy"
            :aria-label="busy ? 'Generando' : 'Enviar'"
            @click="submit()"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <NsfwSessionSheet ref="sheet" :session-id="sessionId" hide-trigger />
  </div>
</template>
