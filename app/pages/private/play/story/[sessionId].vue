<script setup lang="ts">
import type { GenerationProfile, PlayerInput } from '../../../../../shared/types/nsfw/session.ts'

definePageMeta({ layout: 'private' })

const route = useRoute()
const sessions = useNsfwSessionsStore()
const sessionId = computed(() => String(route.params.sessionId || ''))

const draft = ref('')
const inputKind = ref<'speak' | 'act' | 'free'>('free')
const modelAlias = ref('')
const compareModelAlias = ref('')
const generationProfile = ref<GenerationProfile>('quick')
const localError = ref<string | null>(null)
const toolsOpen = ref(false)

await sessions.loadModels()
await sessions.loadPlay(sessionId.value)

watch(
  () => sessions.play?.session,
  (current) => {
    if (!current) return
    modelAlias.value = current.modelAlias
    generationProfile.value = current.generationProfile
  },
  { immediate: true }
)

watch(
  () => sessions.models.map((model) => model.alias).join('|'),
  () => {
    if (!compareModelAlias.value && sessions.models[1]) {
      compareModelAlias.value = sessions.models[1].alias
    }
  },
  { immediate: true }
)

const beats = computed(() => sessions.play?.beats ?? [])
const attempt = computed(() => sessions.play?.activeAttempt ?? null)
const siblings = computed(() => sessions.play?.siblingAttempts ?? [])
const session = computed(() => sessions.play?.session ?? null)
const busy = computed(
  () =>
    sessions.loading ||
    Boolean(attempt.value && ['requested', 'streaming', 'validating'].includes(attempt.value.state))
)

const lastChoices = computed(() => {
  const last = beats.value[beats.value.length - 1]
  return last?.envelope.choices ?? []
})

function unitLabel(actorId: string) {
  return session.value?.cast.find((member) => member.actorId === actorId)?.name || actorId
}

function looksLikeJson(value: string) {
  const trimmed = value.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('```') || trimmed.startsWith('[')
}

async function submit(kind: PlayerInput['kind'] = inputKind.value, text = draft.value, choiceId?: string) {
  localError.value = null
  if (!session.value || busy.value) return
  if (attempt.value && ['requested', 'streaming', 'validating', 'ready'].includes(attempt.value.state)) {
    localError.value = 'Hay una generación en curso o pendiente de aceptar'
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
    localError.value = (caught as Error).message || 'No se pudo generar'
  }
}

async function onAccept() {
  if (!attempt.value) return
  await sessions.accept(sessionId.value, attempt.value.id)
}

async function onDiscard() {
  if (!attempt.value) return
  await sessions.discard(sessionId.value, attempt.value.id)
}

async function onRetry() {
  if (!attempt.value) return
  await sessions.retry(sessionId.value, attempt.value.id)
}

async function onReroll() {
  if (!attempt.value) return
  localError.value = null
  try {
    await sessions.reroll(sessionId.value, attempt.value.id, {
      modelAlias: modelAlias.value,
      generationProfile: generationProfile.value
    })
  } catch (caught) {
    localError.value = (caught as Error).message || 'Re-roll fallido'
  }
}

async function onCompare() {
  if (!attempt.value || !compareModelAlias.value) return
  localError.value = null
  try {
    await sessions.reroll(sessionId.value, attempt.value.id, {
      modelAlias: compareModelAlias.value,
      generationProfile: generationProfile.value
    })
  } catch (caught) {
    localError.value = (caught as Error).message || 'Comparación fallida'
  }
}

async function onSelectSibling(id: string) {
  await sessions.selectSibling(sessionId.value, id)
}

async function onFork(beatId: string) {
  localError.value = null
  try {
    const forked = await sessions.forkBeat(beatId)
    await navigateTo(`/private/play/story/${forked.id}`)
  } catch (caught) {
    localError.value = (caught as Error).message || 'No se pudo bifurcar'
  }
}

async function onFinalize() {
  await sessions.finalize(sessionId.value)
  toolsOpen.value = false
}

async function onSequel() {
  const sequel = await sessions.sequel(sessionId.value)
  await navigateTo(`/private/play/story/${sequel.id}`)
}

async function onArchive() {
  await sessions.archive(sessionId.value, true)
  await navigateTo('/private/library')
}

function useChoice(choiceId: string, label: string, kind: 'speak' | 'act' | 'choice') {
  return submit(kind === 'choice' ? 'choice' : kind, label, choiceId)
}
</script>

<template>
  <div class="nsfw-page mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
    <header class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-xs uppercase tracking-[0.2em] text-[var(--nsfw-faint)]">
          Story
          <span v-if="session?.branchLabel"> · {{ session.branchLabel }}</span>
          <span v-if="session?.finalizedAt"> · Finalizada</span>
        </p>
        <h1 class="font-serif text-3xl">{{ session?.title || 'Historia' }}</h1>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <div class="relative">
          <button
            type="button"
            class="nsfw-btn-ghost"
            :aria-expanded="toolsOpen"
            @click="toolsOpen = !toolsOpen"
          >
            Acciones
          </button>
          <div
            v-if="toolsOpen"
            class="absolute right-0 z-20 mt-2 min-w-40 rounded-xl border border-[var(--nsfw-line)] bg-[var(--nsfw-raised)] p-1 shadow-lg"
          >
            <button
              v-if="!session?.finalizedAt"
              type="button"
              class="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--nsfw-soft)]"
              @click="onFinalize"
            >
              Finalizar
            </button>
            <button
              type="button"
              class="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--nsfw-soft)]"
              @click="onSequel"
            >
              Secuela
            </button>
            <button
              type="button"
              class="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--nsfw-soft)]"
              @click="onArchive"
            >
              Archivar
            </button>
          </div>
        </div>
        <NsfwSessionSheet :session-id="sessionId" />
      </div>
    </header>

    <article class="nsfw-card space-y-6 font-serif text-[clamp(1.16rem,1.5vw,1.35rem)] leading-[1.65]">
      <p v-if="beats.length === 0" class="text-[var(--nsfw-muted)]">
        Aún no hay beats aceptados. Habla, actúa o deja que la escena empiece.
      </p>
      <div
        v-for="beat in beats"
        :key="beat.id"
        class="space-y-3 border-b border-[var(--nsfw-line)] pb-4 last:border-0"
      >
        <div v-for="(unit, index) in beat.envelope.visibleUnits" :key="`${beat.id}-${index}`">
          <p v-if="unit.type === 'narration'">{{ unit.text }}</p>
          <p v-else>
            <span class="text-[var(--nsfw-gold)]">{{ unitLabel(unit.actorId) }}:</span>
            {{ unit.text }}
          </p>
        </div>
        <button type="button" class="nsfw-btn-ghost text-xs" @click="onFork(beat.id)">
          Bifurcar desde aquí
        </button>
      </div>

      <div
        v-if="busy || (attempt && ['streaming', 'validating', 'ready'].includes(attempt.state))"
        class="rounded-xl border border-dashed border-[var(--nsfw-line)] bg-[var(--nsfw-soft)]/60 p-4 text-[var(--nsfw-muted)]"
        aria-live="polite"
      >
        <p class="mb-2 text-xs uppercase tracking-wide text-[var(--nsfw-faint)]">
          <template v-if="busy && attempt?.state !== 'ready'">Generando…</template>
          <template v-else-if="attempt?.state === 'ready'">Listo para aceptar</template>
          <template v-else>Provisional</template>
          <span v-if="attempt?.modelAlias"> · {{ attempt.modelAlias }}</span>
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
    </article>

    <section v-if="siblings.length > 1" class="flex flex-wrap gap-2">
      <button
        v-for="(sibling, index) in siblings"
        :key="sibling.id"
        type="button"
        class="nsfw-btn-ghost"
        :class="sibling.id === attempt?.id ? 'text-[var(--nsfw-accent)]' : ''"
        @click="onSelectSibling(sibling.id)"
      >
        Alt {{ index + 1 }} · {{ sibling.state }}
      </button>
    </section>

    <p v-if="attempt?.state === 'failed'" class="text-sm text-[var(--nsfw-danger)]">
      {{ attempt.errorMessage || 'Falló la generación' }}
    </p>
    <p v-if="attempt?.state === 'stale'" class="text-sm text-[var(--nsfw-danger)]">
      Resultado obsoleto: el estado de la rama cambió. Descarta y genera de nuevo.
    </p>
    <p v-if="localError" class="text-sm text-[var(--nsfw-danger)]">{{ localError }}</p>

    <section v-if="attempt?.state === 'ready'" class="flex flex-wrap gap-2">
      <button type="button" class="nsfw-btn-primary" @click="onAccept">Aceptar</button>
      <button type="button" class="nsfw-btn-ghost" @click="onReroll">Re-roll</button>
      <button type="button" class="nsfw-btn-ghost" @click="onCompare">Comparar modelo</button>
      <button type="button" class="nsfw-btn-ghost" @click="onDiscard">Descartar</button>
    </section>

    <section v-else-if="attempt?.state === 'failed'" class="flex flex-wrap gap-2">
      <button
        v-if="attempt.retryCount < 1"
        type="button"
        class="nsfw-btn-primary"
        @click="onRetry"
      >
        Reintentar
      </button>
      <button type="button" class="nsfw-btn-ghost" @click="onDiscard">Descartar</button>
      <button type="button" class="nsfw-btn-ghost" @click="generationProfile = 'quick'">
        Usar Quick
      </button>
    </section>

    <NsfwFeedbackStrip
      :session-id="sessionId"
      :attempt-id="attempt?.id"
      :beat-count="beats.length"
    />
    <NsfwAudioAffordances />

    <section
      v-if="(!attempt || !['ready', 'streaming', 'validating'].includes(attempt.state)) && lastChoices.length"
      class="flex flex-wrap gap-2"
    >
      <button
        v-for="choice in lastChoices"
        :key="choice.id"
        type="button"
        class="nsfw-btn-ghost"
        :class="choice.prominence === 'primary' ? 'border-[var(--nsfw-accent)]' : ''"
        @click="useChoice(choice.id, choice.label, choice.kind)"
      >
        {{ choice.label }}
      </button>
    </section>

    <section class="nsfw-card space-y-3">
      <details class="group">
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
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-[var(--nsfw-faint)]">Comparar con</span>
            <select v-model="compareModelAlias" class="nsfw-input w-full">
              <option
                v-for="model in sessions.models"
                :key="`cmp-${model.alias}`"
                :value="model.alias"
              >
                {{ model.alias }}
              </option>
            </select>
          </label>
          <label class="block sm:col-span-2">
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
          @click="inputKind = 'speak'"
        >
          Speak
        </button>
        <button
          type="button"
          class="nsfw-btn-ghost"
          :class="inputKind === 'act' ? 'text-[var(--nsfw-accent)]' : ''"
          @click="inputKind = 'act'"
        >
          Act
        </button>
        <button
          type="button"
          class="nsfw-btn-ghost"
          :class="inputKind === 'free' ? 'text-[var(--nsfw-accent)]' : ''"
          @click="inputKind = 'free'"
        >
          Libre
        </button>
        <button type="button" class="nsfw-btn-ghost" @click="submit('continue', '')">
          Continuar
        </button>
      </div>

      <textarea
        v-model="draft"
        class="nsfw-input min-h-24 w-full"
        :placeholder="inputKind === 'speak' ? 'Qué dices…' : inputKind === 'act' ? 'Qué haces…' : 'Input libre…'"
      />
      <button
        type="button"
        class="nsfw-btn-primary"
        :disabled="busy || Boolean(attempt && ['ready', 'streaming', 'validating'].includes(attempt.state)) || Boolean(session?.finalizedAt)"
        @click="submit()"
      >
        {{ busy ? 'Generando…' : 'Enviar' }}
      </button>
    </section>
  </div>
</template>
