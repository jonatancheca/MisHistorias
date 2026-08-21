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
const bibleEntity = ref('')
const bibleText = ref('')
const directorOpen = ref(false)
const planSummaryDraft = ref('')

await sessions.loadModels()
await sessions.loadPlay(sessionId.value)

watchEffect(() => {
  const current = sessions.play?.session
  if (!current) return
  if (!modelAlias.value) modelAlias.value = current.modelAlias
  if (!compareModelAlias.value && sessions.models[1]) {
    compareModelAlias.value = sessions.models[1].alias
  }
  generationProfile.value = current.generationProfile
  if (!planSummaryDraft.value) planSummaryDraft.value = current.plan.summary
})

const beats = computed(() => sessions.play?.beats ?? [])
const attempt = computed(() => sessions.play?.activeAttempt ?? null)
const siblings = computed(() => sessions.play?.siblingAttempts ?? [])
const session = computed(() => sessions.play?.session ?? null)

const lastChoices = computed(() => {
  const last = beats.value[beats.value.length - 1]
  return last?.envelope.choices ?? []
})

function unitLabel(actorId: string) {
  return session.value?.cast.find((member) => member.actorId === actorId)?.name || actorId
}

async function submit(kind: PlayerInput['kind'] = inputKind.value, text = draft.value, choiceId?: string) {
  localError.value = null
  if (!session.value) return
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

async function toggleHeart() {
  if (!session.value) return
  await $fetch(`/api/private/sessions/${sessionId.value}/escalation`, {
    method: 'POST',
    body: { value: !session.value.escalationHeart }
  })
  await sessions.loadPlay(sessionId.value)
}

async function savePlan() {
  if (!session.value) return
  await $fetch(`/api/private/sessions/${sessionId.value}/plan`, {
    method: 'PATCH',
    body: { summary: planSummaryDraft.value }
  })
  await sessions.loadPlay(sessionId.value)
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
}

async function onSequel() {
  const sequel = await sessions.sequel(sessionId.value)
  await navigateTo(`/private/play/story/${sequel.id}`)
}

async function onArchive() {
  await sessions.archive(sessionId.value, true)
  await navigateTo('/private/library')
}

const castDrafts = ref<Record<string, { name: string; characterization: string; personality: string }>>({})
const castMessage = ref<string | null>(null)

watchEffect(() => {
  const members = session.value?.cast || []
  for (const member of members) {
    if (castDrafts.value[member.actorId]) continue
    castDrafts.value[member.actorId] = {
      name: member.overrideName || member.name,
      personality: member.personality || '',
      characterization: member.characterization || ''
    }
  }
})

async function saveCast(actorId: string) {
  const draft = castDrafts.value[actorId]
  if (!draft) return
  castMessage.value = null
  await $fetch(`/api/private/sessions/${sessionId.value}/cast/${actorId}`, {
    method: 'POST',
    body: {
      name: draft.name,
      overrideName: draft.name,
      personality: draft.personality,
      characterization: draft.characterization
    }
  })
  await sessions.loadPlay(sessionId.value)
  castMessage.value = 'Caracterización guardada (Personaje fuente intacto)'
}

async function cloneCast(actorId: string) {
  const draft = castDrafts.value[actorId]
  const result = await $fetch<{ character: { id: string; name: string } }>(
    `/api/private/sessions/${sessionId.value}/cast/${actorId}`,
    {
      method: 'POST',
      body: { action: 'clone', name: draft?.name }
    }
  )
  castMessage.value = `Clone privado creado: ${result.character.name}`
}

async function onAddFact() {
  if (!bibleEntity.value.trim() || !bibleText.value.trim()) return
  await sessions.addBibleFact(sessionId.value, {
    entity: bibleEntity.value,
    text: bibleText.value,
    knownByProtagonist: true
  })
  bibleEntity.value = ''
  bibleText.value = ''
}

function useChoice(choiceId: string, label: string, kind: 'speak' | 'act' | 'choice') {
  return submit(kind === 'choice' ? 'choice' : kind, label, choiceId)
}
</script>

<template>
  <div class="nsfw-page mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
    <header>
      <p class="text-xs uppercase tracking-[0.2em] text-[var(--nsfw-faint)]">
        Story
        <span v-if="session?.branchLabel"> · {{ session.branchLabel }}</span>
        <span v-if="session?.finalizedAt"> · Finalizada</span>
      </p>
      <h1 class="font-serif text-3xl">{{ session?.title || 'Historia' }}</h1>
      <p class="mt-2 rounded-xl border border-[var(--nsfw-line)] bg-[var(--nsfw-raised)] px-3 py-2 text-sm text-[var(--nsfw-muted)]">
        Historia privada. No se publica ni aparece en el Hub salvo que lo autorices más adelante.
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          class="nsfw-btn-ghost"
          :class="session?.escalationHeart ? 'text-[var(--nsfw-accent)]' : ''"
          title="Corazón de escalada"
          @click="toggleHeart"
        >
          ♥ Escalada
        </button>
        <button
          v-if="!session?.finalizedAt"
          type="button"
          class="nsfw-btn-ghost"
          @click="onFinalize"
        >
          Finalizar
        </button>
        <button type="button" class="nsfw-btn-ghost" @click="onSequel">Secuela</button>
        <button type="button" class="nsfw-btn-ghost" @click="onArchive">Archivar</button>
      </div>
    </header>

    <article class="nsfw-card space-y-6 font-serif text-[clamp(1.16rem,1.5vw,1.35rem)] leading-[1.65]">
      <p v-if="beats.length === 0" class="text-[var(--nsfw-muted)]">
        Aún no hay beats aceptados. Habla, actúa o deja que la escena empiece.
      </p>
      <div v-for="beat in beats" :key="beat.id" class="space-y-3 border-b border-[var(--nsfw-line)] pb-4 last:border-0">
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
        v-if="attempt && ['streaming', 'validating', 'ready'].includes(attempt.state)"
        class="rounded-xl border border-dashed border-[var(--nsfw-line)] bg-[var(--nsfw-soft)]/60 p-4 text-[var(--nsfw-muted)]"
        aria-live="polite"
      >
        <p class="mb-2 text-xs uppercase tracking-wide text-[var(--nsfw-faint)]">
          {{ attempt.state === 'ready' ? 'Listo para aceptar' : 'Provisional' }}
          · {{ attempt.modelAlias }}
        </p>
        <p class="whitespace-pre-wrap">{{ attempt.provisionalText || 'Generando…' }}</p>
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
      <div class="grid gap-3 sm:grid-cols-2">
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
            <option v-for="model in sessions.models" :key="`cmp-${model.alias}`" :value="model.alias">
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
        :disabled="sessions.loading || Boolean(attempt && ['ready', 'streaming', 'validating'].includes(attempt.state)) || Boolean(session?.finalizedAt)"
        @click="submit()"
      >
        {{ sessions.loading ? 'Generando…' : 'Enviar' }}
      </button>
    </section>

    <section class="nsfw-card space-y-3">
      <h2 class="text-sm font-medium text-[var(--nsfw-muted)]">Caracterización</h2>
      <p class="text-xs text-[var(--nsfw-faint)]">
        Override local de la sesión. No muta el Personaje fuente. Clone = copia privada explícita.
      </p>
      <p v-if="castMessage" class="text-sm text-[var(--nsfw-success)]">{{ castMessage }}</p>
      <div
        v-for="member in session?.cast || []"
        :key="member.actorId"
        class="space-y-2 border-t border-[var(--nsfw-line)] pt-3 first:border-0 first:pt-0"
      >
        <p class="text-xs uppercase tracking-wide text-[var(--nsfw-faint)]">
          {{ member.role }} · {{ member.actorId }}
          <span v-if="member.isSelfInsert"> · self-insert</span>
        </p>
        <input
          v-if="castDrafts[member.actorId]"
          v-model="castDrafts[member.actorId].name"
          class="nsfw-input w-full"
          placeholder="Nombre en esta historia"
        >
        <input
          v-if="castDrafts[member.actorId]"
          v-model="castDrafts[member.actorId].personality"
          class="nsfw-input w-full"
          placeholder="Énfasis de personalidad"
        >
        <textarea
          v-if="castDrafts[member.actorId]"
          v-model="castDrafts[member.actorId].characterization"
          class="nsfw-input min-h-20 w-full"
          placeholder="Caracterización de sesión"
        />
        <div class="flex flex-wrap gap-2">
          <button type="button" class="nsfw-btn-primary" @click="saveCast(member.actorId)">
            Guardar override
          </button>
          <button type="button" class="nsfw-btn-ghost" @click="cloneCast(member.actorId)">
            Guardar como Clone
          </button>
        </div>
      </div>
    </section>

    <section class="nsfw-card space-y-3">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-sm font-medium text-[var(--nsfw-muted)]">Director View</h2>
        <button type="button" class="nsfw-btn-ghost" @click="directorOpen = !directorOpen">
          {{ directorOpen ? 'Ocultar' : 'Mostrar' }}
        </button>
      </div>
      <div v-if="directorOpen" class="space-y-3">
        <p class="text-xs text-[var(--nsfw-faint)]">
          Plan mutable. No reescribe beats aceptados. Sin spoilers extra.
        </p>
        <textarea v-model="planSummaryDraft" class="nsfw-input min-h-20 w-full" />
        <ul class="space-y-1 text-sm text-[var(--nsfw-muted)]">
          <li v-for="beat in session?.plan.nextBeats || []" :key="beat.id">
            {{ beat.status }} · {{ beat.intent }}
          </li>
        </ul>
        <button type="button" class="nsfw-btn-primary" @click="savePlan">Guardar plan</button>
      </div>
    </section>

    <section class="nsfw-card space-y-3">
      <h2 class="text-sm font-medium text-[var(--nsfw-muted)]">Bible · corrección factual</h2>
      <ul v-if="session?.bible.facts.length" class="space-y-1 text-sm text-[var(--nsfw-muted)]">
        <li v-for="fact in session.bible.facts" :key="fact.id">
          <span class="text-[var(--nsfw-ink)]">{{ fact.entity }}:</span> {{ fact.text }}
        </li>
      </ul>
      <div class="grid gap-2 sm:grid-cols-2">
        <input v-model="bibleEntity" class="nsfw-input" placeholder="Entidad">
        <input v-model="bibleText" class="nsfw-input" placeholder="Hecho">
      </div>
      <button type="button" class="nsfw-btn-ghost" @click="onAddFact">Guardar hecho</button>
    </section>
  </div>
</template>
