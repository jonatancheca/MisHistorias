<script setup lang="ts">
import type {
  GenerationProfile,
  PlayerInput,
  SessionSheetTab
} from '../../../../../shared/types/nsfw/session.ts'
import { sceneIntensity } from '../../../../../shared/lib/nsfwCreatorConfig.ts'

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
const branchesOpen = ref(false)
const sheet = ref<{ openSheet: (tab?: SessionSheetTab) => void } | null>(null)

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
const locked = computed(
  () => busy.value || Boolean(attempt.value && ['ready', 'streaming', 'validating'].includes(attempt.value.state))
)

const lastChoices = computed(() => {
  const last = beats.value[beats.value.length - 1]
  return last?.envelope.choices ?? []
})

const modelAvailable = computed(
  () => sessions.models.find((model) => model.alias === modelAlias.value)?.available ?? false
)

const intensity = computed(() =>
  sceneIntensity(session.value?.tone || 'sensual', Boolean(session.value?.escalationHeart))
)

const characters = computed(() => session.value?.cast || [])

const nextIntent = computed(
  () => session.value?.plan.nextBeats.find((beat) => beat.status === 'pending')?.intent || null
)

const placeholder = computed(() =>
  inputKind.value === 'speak' ? 'Dices…' : inputKind.value === 'act' ? 'Haces…' : 'Escribe…'
)

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

async function toggleHeart() {
  if (!session.value) return
  await $fetch(`/api/private/sessions/${sessionId.value}/escalation`, {
    method: 'POST',
    body: { value: !session.value.escalationHeart }
  })
  await sessions.loadPlay(sessionId.value)
}

function useChoice(choiceId: string, label: string, kind: 'speak' | 'act' | 'choice') {
  return submit(kind === 'choice' ? 'choice' : kind, label, choiceId)
}
</script>

<template>
  <div class="nsfw-page flex min-h-full">
    <div class="relative flex min-w-0 flex-1 flex-col">
      <!-- El chrome se retira: título a la izquierda, acciones en texto. -->
      <div class="nsfw-topbar">
        <div class="flex min-w-0 items-baseline gap-3">
          <span class="truncate font-serif text-[1.05rem]">{{ session?.title || 'Historia' }}</span>
          <span class="shrink-0 text-[0.7rem] text-[var(--nsfw-dim)]">
            <template v-if="session?.branchLabel">{{ session.branchLabel }} · </template>
            beat {{ beats.length }}
            <template v-if="session?.finalizedAt"> · finalizada</template>
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
          <button type="button" class="nsfw-btn-text" @click="sheet?.openSheet('bible')">
            Biblia
          </button>
          <button type="button" class="nsfw-btn-text" @click="sheet?.openSheet('direction')">
            Director
          </button>
          <button
            type="button"
            class="nsfw-btn-text"
            :aria-expanded="branchesOpen"
            @click="branchesOpen = !branchesOpen"
          >
            Ramas
          </button>
          <div class="relative">
            <button
              type="button"
              class="nsfw-btn-text"
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
          <span class="h-3 w-px bg-[var(--nsfw-line)]" />
          <button type="button" class="nsfw-btn-text" @click="sheet?.openSheet('usage')">
            <span
              class="h-1 w-1 rounded-full"
              :style="{ background: modelAvailable ? 'var(--nsfw-success)' : 'var(--nsfw-gold)' }"
            />
            {{ modelAlias || '—' }} · {{ generationProfile === 'quick' ? 'rápido' : 'calidad' }}
          </button>
        </div>
      </div>

      <!-- Columna de lectura: la prosa manda. -->
      <div class="flex-1 px-6 pt-2 pb-8">
        <article class="nsfw-prose">
          <p v-if="beats.length === 0" class="text-[var(--nsfw-muted)] italic">
            Aún no hay beats aceptados. Habla, actúa o deja que la escena empiece.
          </p>

          <div v-for="(beat, beatIndex) in beats" :key="beat.id" class="group">
            <p
              v-for="(unit, index) in beat.envelope.visibleUnits"
              :key="`${beat.id}-${index}`"
              :class="unit.type === 'narration' ? '' : 'is-dialogue'"
            >
              <span v-if="unit.type !== 'narration'" class="nsfw-speaker">
                {{ unitLabel(unit.actorId) }}
              </span>
              {{ unit.text }}
            </p>

            <!-- Acciones del último beat, al pie de la prosa. -->
            <div
              v-if="beatIndex === beats.length - 1"
              class="mb-6 flex flex-wrap items-center gap-5 font-sans text-xs text-[var(--nsfw-dim)]"
            >
              <button
                type="button"
                class="nsfw-btn-text"
                :disabled="!attempt || busy"
                @click="onReroll"
              >
                Otra versión
              </button>
              <button
                type="button"
                class="nsfw-btn-text"
                :disabled="!attempt || busy || !compareModelAlias"
                @click="onCompare"
              >
                Comparar modelo
              </button>
              <button
                type="button"
                class="nsfw-btn-text hover:!text-[var(--nsfw-azure)]"
                @click="onFork(beat.id)"
              >
                Bifurcar
              </button>
            </div>

            <div
              v-else
              class="nsfw-divider opacity-0 transition group-hover:opacity-100 focus-within:opacity-100"
            >
              <button type="button" @click="onFork(beat.id)">Bifurcar aquí</button>
            </div>
          </div>

          <!-- Provisional / generando -->
          <div
            v-if="busy || (attempt && ['streaming', 'validating', 'ready'].includes(attempt.state))"
            class="mb-6 border-l border-[var(--nsfw-line-strong)] pl-5"
            aria-live="polite"
          >
            <p class="nsfw-eyebrow font-sans">
              <template v-if="busy && attempt?.state !== 'ready'">Generando…</template>
              <template v-else-if="attempt?.state === 'ready'">Listo para aceptar</template>
              <template v-else>Provisional</template>
              <span v-if="attempt?.modelAlias"> · {{ attempt.modelAlias }}</span>
            </p>
            <p
              v-if="busy && (!attempt?.provisionalText || looksLikeJson(attempt.provisionalText))"
              class="nsfw-loading-pulse !mb-0 text-[var(--nsfw-muted)]"
            >
              Esperando respuesta del modelo…
            </p>
            <p
              v-else-if="attempt?.provisionalText && !looksLikeJson(attempt.provisionalText)"
              class="!mb-0 whitespace-pre-wrap"
            >
              {{ attempt.provisionalText }}
            </p>
          </div>

          <div v-if="branchesOpen && siblings.length > 1" class="mb-6 flex flex-wrap gap-2 font-sans">
            <button
              v-for="(sibling, index) in siblings"
              :key="sibling.id"
              type="button"
              class="nsfw-choice"
              :class="sibling.id === attempt?.id ? 'is-primary' : ''"
              @click="onSelectSibling(sibling.id)"
            >
              Alt {{ index + 1 }} · {{ sibling.state }}
            </button>
          </div>

          <p v-if="attempt?.state === 'failed'" class="font-sans !text-sm text-[var(--nsfw-danger)]">
            {{ attempt.errorMessage || 'Falló la generación' }}
          </p>
          <p v-if="attempt?.state === 'stale'" class="font-sans !text-sm text-[var(--nsfw-danger)]">
            Resultado obsoleto: el estado de la rama cambió. Descarta y genera de nuevo.
          </p>
          <p v-if="localError" class="font-sans !text-sm text-[var(--nsfw-danger)]">
            {{ localError }}
          </p>
        </article>

        <!-- Sin aside (móvil y tablet) el feedback y el audio viven bajo la prosa. -->
        <div class="mx-auto mt-8 flex max-w-[62ch] flex-col gap-4 xl:hidden">
          <NsfwFeedbackStrip
            :session-id="sessionId"
            :attempt-id="attempt?.id"
            :beat-count="beats.length"
          />
          <NsfwAudioAffordances />
        </div>
      </div>

      <!-- Compositor flotante sobre la lectura -->
      <div class="nsfw-dock">
        <div class="mx-auto max-w-[62ch]">
          <div
            v-if="attempt?.state === 'ready'"
            class="mb-3 flex flex-wrap items-center gap-4"
          >
            <button type="button" class="nsfw-btn-primary" @click="onAccept">Aceptar</button>
            <button type="button" class="nsfw-btn-text" @click="onReroll">Otra versión</button>
            <button type="button" class="nsfw-btn-text" @click="onCompare">Comparar modelo</button>
            <button type="button" class="nsfw-btn-text" @click="onDiscard">Descartar</button>
          </div>

          <div
            v-else-if="attempt?.state === 'failed'"
            class="mb-3 flex flex-wrap items-center gap-4"
          >
            <button
              v-if="attempt.retryCount < 1"
              type="button"
              class="nsfw-btn-primary"
              @click="onRetry"
            >
              Reintentar
            </button>
            <button type="button" class="nsfw-btn-text" @click="onDiscard">Descartar</button>
            <button type="button" class="nsfw-btn-text" @click="generationProfile = 'quick'">
              Usar perfil rápido
            </button>
          </div>

          <div
            v-else-if="lastChoices.length"
            class="mb-3 flex flex-wrap gap-2"
          >
            <button
              v-for="choice in lastChoices"
              :key="choice.id"
              type="button"
              class="nsfw-choice"
              :class="choice.prominence === 'primary' ? 'is-primary' : ''"
              @click="useChoice(choice.id, choice.label, choice.kind)"
            >
              {{ choice.label }}
            </button>
          </div>

          <div class="nsfw-composer">
            <label class="block">
              <span class="sr-only">{{ placeholder }}</span>
              <textarea
                v-model="draft"
                :placeholder="placeholder"
                :disabled="Boolean(session?.finalizedAt)"
                @keydown.enter.exact.prevent="submit()"
              />
            </label>
            <div class="nsfw-composer-bar">
              <div class="nsfw-segment">
                <button
                  type="button"
                  :class="inputKind === 'speak' ? 'is-active' : ''"
                  @click="inputKind = 'speak'"
                >
                  Hablar
                </button>
                <button
                  type="button"
                  :class="inputKind === 'act' ? 'is-active' : ''"
                  @click="inputKind = 'act'"
                >
                  Actuar
                </button>
                <button
                  type="button"
                  :class="inputKind === 'free' ? 'is-active' : ''"
                  @click="inputKind = 'free'"
                >
                  Narrador
                </button>
              </div>
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  class="nsfw-heat-btn"
                  :aria-pressed="Boolean(session?.escalationHeart)"
                  title="Subir la temperatura de la escena"
                  @click="toggleHeart"
                >
                  <span aria-hidden="true">♥</span>
                  {{ session?.escalationHeart ? 'Bajar' : 'Subir' }}
                </button>
                <button
                  type="button"
                  class="nsfw-btn-text"
                  :disabled="locked || Boolean(session?.finalizedAt)"
                  @click="submit('continue', '')"
                >
                  Que siga sola →
                </button>
                <button
                  type="button"
                  class="nsfw-icon-btn"
                  :disabled="locked || Boolean(session?.finalizedAt)"
                  :aria-label="busy ? 'Generando' : 'Enviar'"
                  @click="submit()"
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
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
        </div>
      </div>
    </div>

    <!-- Aside de escena -->
    <aside
      class="sticky top-0 hidden h-dvh w-[290px] shrink-0 flex-col gap-7 overflow-y-auto border-l border-[var(--nsfw-hair)] px-6 py-7 xl:flex"
    >
      <div>
        <p class="nsfw-eyebrow nsfw-eyebrow--dim">Escena</p>
        <p class="font-serif text-xl leading-tight">{{ session?.sceneState.location || '—' }}</p>
        <p class="mt-1 text-xs leading-relaxed text-[var(--nsfw-faint)]">
          {{ session?.sceneState.intention }}
        </p>
      </div>

      <div>
        <p class="nsfw-eyebrow nsfw-eyebrow--dim">Presentes</p>
        <div class="flex flex-col gap-2.5">
          <div v-for="member in characters" :key="member.actorId" class="flex items-center gap-2.5">
            <span class="nsfw-avatar h-7 w-7 text-xs" :class="member.isSelfInsert ? '' : 'is-gold'">
              {{ member.name.slice(0, 1) }}
            </span>
            <div class="min-w-0">
              <p class="truncate text-[0.82rem] text-[var(--nsfw-ink)]">{{ member.name }}</p>
              <p class="truncate text-[0.7rem] text-[var(--nsfw-faint)]">
                {{ member.isSelfInsert ? 'tú' : member.personality || member.role }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <p class="nsfw-eyebrow nsfw-eyebrow--dim">Tensión</p>
        <div class="nsfw-meter mb-2">
          <span v-for="n in 5" :key="n" :class="n <= intensity ? 'is-on' : ''" />
        </div>
        <p class="text-[0.72rem] leading-relaxed text-[var(--nsfw-faint)]">
          {{ session?.escalationHeart ? 'Escalada pedida.' : session?.worldState.mood }}
        </p>
      </div>

      <div v-if="nextIntent">
        <p class="nsfw-eyebrow nsfw-eyebrow--dim">Próximo en el plan</p>
        <p class="font-serif text-base italic leading-relaxed text-[var(--nsfw-muted)]">
          {{ nextIntent }}
        </p>
      </div>

      <NsfwFeedbackStrip
        :session-id="sessionId"
        :attempt-id="attempt?.id"
        :beat-count="beats.length"
      />
      <NsfwAudioAffordances />

      <div class="flex-1" />

      <div class="flex flex-col gap-2.5 border-t border-[var(--nsfw-hair)] pt-4 text-xs">
        <div class="flex items-center justify-between gap-3">
          <span class="text-[var(--nsfw-faint)]">Modelo</span>
          <select
            v-model="modelAlias"
            class="min-w-0 max-w-[9rem] truncate border-0 bg-transparent text-right text-xs text-[var(--nsfw-muted)] outline-none"
          >
            <option v-for="model in sessions.models" :key="model.alias" :value="model.alias">
              {{ model.alias }}
            </option>
          </select>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-[var(--nsfw-faint)]">Comparar con</span>
          <select
            v-model="compareModelAlias"
            class="min-w-0 max-w-[9rem] truncate border-0 bg-transparent text-right text-xs text-[var(--nsfw-muted)] outline-none"
          >
            <option
              v-for="model in sessions.models"
              :key="`cmp-${model.alias}`"
              :value="model.alias"
            >
              {{ model.alias }}
            </option>
          </select>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-[var(--nsfw-faint)]">Perfil</span>
          <select
            v-model="generationProfile"
            class="border-0 bg-transparent text-right text-xs text-[var(--nsfw-muted)] outline-none"
          >
            <option value="quick">Rápido</option>
            <option value="quality">Calidad</option>
          </select>
        </div>
        <div v-if="attempt" class="flex items-center justify-between gap-3">
          <span class="text-[var(--nsfw-faint)]">Último beat</span>
          <span class="text-[var(--nsfw-muted)]">
            {{ (attempt.latencyMs / 1000).toFixed(1) }} s · {{ attempt.usage.totalTokens }} tk
          </span>
        </div>
      </div>
    </aside>

    <NsfwSessionSheet ref="sheet" :session-id="sessionId" hide-trigger />
  </div>
</template>
