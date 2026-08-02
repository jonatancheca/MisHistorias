<script setup lang="ts">
import type { LlmDebugTrace, Message } from '#shared/types'
import { primaryTag } from '~/lib/tags'

const route = useRoute()
const stories = useStoriesStore()
const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const settings = useSettingsStore()
const confirmDialog = useConfirmStore()
const {
  hidden: mobileChromeHidden,
  hide: hideMobileChrome,
  show: showMobileChrome
} = useMobileChrome()

await Promise.all([
  characters.load(),
  backgrounds.load(),
  settings.load(),
  stories.openStory(String(route.params.id))
])

const input = ref('')
const scroller = ref<HTMLElement | null>(null)
const selectedDebugTrace = ref<LlmDebugTrace | null>(null)
const storyPreferencesOpen = ref(false)
const storyPreferences = ref('')
const storyPreferencesMode = ref<'append' | 'replace'>('append')
let lastScrollTop = 0
let autoScrollTarget: number | null = null
let accumulatedScroll = 0
let desktopMedia: MediaQueryList | null = null

type TimelineItem =
  | { kind: 'message'; id: string; createdAt: number; message: Message }
  | { kind: 'trace'; id: string; createdAt: number; trace: LlmDebugTrace }

const timeline = computed<TimelineItem[]>(() => {
  return [
    ...stories.messages.map((message) => ({
      kind: 'message' as const,
      id: message.id,
      createdAt: message.createdAt,
      message
    })),
    ...stories.debugTraces
      .filter((trace) => trace.status === 'error' || !trace.responseMessageId)
      .map((trace) => ({
        kind: 'trace' as const,
        id: trace.id,
        createdAt: trace.createdAt,
        trace
      }))
  ].sort((a, b) => a.createdAt - b.createdAt)
})

function debugForMessage(id: string) {
  return stories.debugTraces.find((trace) => trace.responseMessageId === id) ?? null
}

function traceErrorMessage(trace: LlmDebugTrace) {
  if ('error' in trace.response) return trace.response.error
  if (trace.response.finishReason === 'length') {
    return 'El modelo alcanzó el máximo de tokens antes de devolver contenido visible.'
  }
  return 'El modelo no devolvió contenido visible.'
}

const lastDialogue = computed(() => {
  for (let index = stories.messages.length - 1; index >= 0; index -= 1) {
    const message = stories.messages[index]!
    for (let cursor = message.segments.length - 1; cursor >= 0; cursor -= 1) {
      const segment = message.segments[cursor]!
      if (segment.type === 'dialogue' && segment.characterId) return segment
    }
  }
  return null
})

async function scrollToBottom() {
  await nextTick()
  if (!scroller.value) return
  autoScrollTarget = Math.max(0, scroller.value.scrollHeight - scroller.value.clientHeight)
  scroller.value.scrollTop = scroller.value.scrollHeight
  lastScrollTop = scroller.value.scrollTop
}

watch(timeline, scrollToBottom, { deep: true, immediate: true })
watch(
  () => stories.error,
  (value) => {
    if (value) void scrollToBottom()
  }
)

async function submit() {
  const text = input.value
  if (!text.trim() || stories.generating) return
  input.value = ''
  await stories.send(text)
}

const isEmpty = computed(() => timeline.value.length === 0 && !stories.generating)

function onStoryScroll() {
  if (window.innerWidth >= 640) {
    showMobileChrome()
    return
  }
  const current = scroller.value?.scrollTop ?? 0
  const delta = current - lastScrollTop
  lastScrollTop = current

  if (autoScrollTarget !== null) {
    const reachedTarget = Math.abs(current - autoScrollTarget) <= 1
    autoScrollTarget = null
    if (reachedTarget) return
  }

  if (current <= 8) {
    accumulatedScroll = 0
    showMobileChrome()
    return
  }
  if (Math.sign(delta) !== Math.sign(accumulatedScroll)) accumulatedScroll = 0
  accumulatedScroll += delta
  if (accumulatedScroll >= 12) {
    hideMobileChrome()
    accumulatedScroll = 0
  } else if (accumulatedScroll <= -4) {
    showMobileChrome()
    accumulatedScroll = 0
  }
}

function openStoryPreferences() {
  if (!stories.activeStory) return
  storyPreferences.value = stories.activeStory.protagonistPreferences ?? ''
  storyPreferencesMode.value = stories.activeStory.protagonistPreferencesMode ?? 'append'
  storyPreferencesOpen.value = true
}

async function saveStoryPreferences() {
  await stories.updateStoryPreferences(storyPreferences.value, storyPreferencesMode.value)
  storyPreferencesOpen.value = false
}

async function removeMessage(id: string) {
  const accepted = await confirmDialog.ask({
    title: 'Borrar mensaje',
    message: 'Este mensaje se borrará definitivamente.'
  })
  if (accepted) await stories.removeMessage(id)
}

async function regenerateFrom(id: string) {
  const index = stories.messages.findIndex((message) => message.id === id)
  if (index < 0) return
  const following = stories.messages.length - index - 1
  const accepted = await confirmDialog.ask({
    title: 'Regenerar desde aquí',
    message: following
      ? `Se borrarán esta respuesta y ${following} mensajes posteriores antes de generar otra.`
      : 'Se borrará esta respuesta antes de generar otra.',
    confirmLabel: 'Regenerar'
  })
  if (accepted) await stories.regenerateFrom(id)
}

async function resendFrom(id: string) {
  const index = stories.messages.findIndex((message) => message.id === id)
  if (index < 0) return
  const following = stories.messages.length - index - 1
  const deleted = following === 1 ? '1 mensaje posterior' : `${following} mensajes posteriores`
  const accepted = await confirmDialog.ask({
    title: 'Reenviar desde aquí',
    message: following
      ? `Se borrarán ${deleted} antes de generar otra respuesta.`
      : 'Se reenviará este mensaje para generar otra respuesta.',
    confirmLabel: 'Reenviar'
  })
  if (accepted) await stories.resendFrom(id)
}

function onBreakpointChange(event: MediaQueryListEvent) {
  if (event.matches) showMobileChrome()
}

onMounted(() => {
  desktopMedia = window.matchMedia('(min-width: 640px)')
  desktopMedia.addEventListener('change', onBreakpointChange)
})

const initialBackground = computed(() =>
  backgrounds.byId(stories.activeStory?.initialBackgroundId)
)

const currentBackground = computed(() => {
  let id = stories.activeStory?.initialBackgroundId ?? null
  let tag = primaryTag(backgrounds.byId(id))
  for (const message of stories.messages) {
    for (const segment of message.segments) {
      if (segment.type !== 'background') continue
      id = Object.prototype.hasOwnProperty.call(segment, 'backgroundId')
        ? (segment.backgroundId ?? null)
        : backgrounds.byTag(segment.tag)?.id ?? null
      tag = segment.tag
    }
  }
  return { id, tag }
})

onBeforeUnmount(() => {
  desktopMedia?.removeEventListener('change', onBreakpointChange)
  showMobileChrome()
})
</script>

<template>
  <div v-if="!stories.activeStory" class="p-8">
    <p class="card text-sm">Historia no encontrada.</p>
  </div>

  <div v-else class="flex h-full min-h-0">
    <section class="flex min-w-0 flex-1 flex-col">
      <header
        class="flex shrink-0 items-center justify-between border-b border-[var(--color-border-soft)] px-4 transition-[max-height,opacity,padding,transform] duration-200 sm:max-h-none sm:translate-y-0 sm:px-6 sm:py-4 sm:opacity-100"
        :class="
          mobileChromeHidden
            ? 'max-h-0 -translate-y-2 overflow-hidden border-b-0 py-0 opacity-0'
            : 'max-h-24 translate-y-0 py-3 opacity-100'
        "
      >
        <div class="min-w-0">
          <h1 class="truncate text-lg font-bold">
            {{ stories.activeStory.title }}
            <span
              v-if="settings.settings.mockMode"
              class="ml-2 rounded-full bg-brand-500/15 px-2 py-0.5 align-middle text-xs font-semibold text-brand-600"
            >
              modo prueba
            </span>
          </h1>
          <p class="truncate text-xs text-[var(--color-fg-muted)]">
            {{ stories.activeStory.premise }}
          </p>
        </div>
        <div class="flex shrink-0 gap-2">
          <button
            type="button"
            class="btn-ghost"
            aria-label="Preferencias de la historia"
            title="Preferencias del protagonista"
            :disabled="stories.generating"
            @click="openStoryPreferences"
          >
            <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
            </svg>
            <span class="hidden sm:inline">Preferencias</span>
          </button>
          <NuxtLink to="/" class="btn-ghost">Historias</NuxtLink>
        </div>
      </header>

      <div
        ref="scroller"
        class="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6"
        @scroll.passive="onStoryScroll"
      >
        <div class="mx-auto max-w-3xl space-y-3">
          <figure v-if="stories.activeStory.initialBackgroundId" class="mb-5">
            <ImageLightbox
              v-if="initialBackground && backgrounds.urlFor(initialBackground.id)"
              :src="backgrounds.urlFor(initialBackground.id)!"
              :alt="`Fondo inicial ${primaryTag(initialBackground) ?? ''}`"
              container-class="w-full"
              image-class="max-h-[32rem] w-full rounded-2xl bg-black/5 object-contain"
            />
            <div
              v-else
              class="rounded-xl border border-dashed border-[var(--color-border-soft)] p-4 text-sm text-[var(--color-fg-muted)]"
            >
              Fondo inicial · fondo no disponible
            </div>
            <figcaption v-if="initialBackground" class="mt-1 text-xs text-[var(--color-fg-muted)]">
              Fondo inicial · {{ primaryTag(initialBackground) }}
            </figcaption>
          </figure>

          <div v-if="isEmpty" class="card text-sm text-[var(--color-fg-muted)]">
            La historia aún no ha empezado.
            <button type="button" class="text-brand-600 underline" @click="stories.generate()">
              Deja que el narrador abra la escena
            </button>
            o escribe tú el primer movimiento.
          </div>

          <template v-for="item in timeline" :key="`${item.kind}-${item.id}`">
            <MessageBubble
              v-if="item.kind === 'message'"
              :message="item.message"
              :debug-trace="debugForMessage(item.message.id)"
              :editable="!stories.generating"
              @debug="selectedDebugTrace = $event"
              @edit="stories.updateMessage(item.message.id, $event)"
              @remove="removeMessage(item.message.id)"
              @regenerate="regenerateFrom(item.message.id)"
              @resend="resendFrom(item.message.id)"
            />

            <div v-else class="group flex min-w-0 items-start gap-2">
              <div
                class="flex w-8 shrink-0 text-red-500 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
              >
                <button
                  type="button"
                  class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-red-500/10"
                  aria-label="Ver datos de debug del error LLM"
                  title="Debug LLM"
                  @click="selectedDebugTrace = item.trace"
                >
                  <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M8 2h8M9 2v3m6-3v3M4 13h3m10 0h3M5 7l3 2m11-2-3 2M5 19l3-2m11 2-3-2" />
                    <rect x="7" y="5" width="10" height="16" rx="5" />
                    <path d="M9 11h6m-6 4h6" />
                  </svg>
                </button>
              </div>
              <p
                class="min-w-0 flex-1 rounded-lg bg-red-500/10 px-4 py-2 text-sm break-words text-red-500"
                role="alert"
              >
                {{ traceErrorMessage(item.trace) }}
              </p>
            </div>
          </template>

          <p
            v-if="stories.error"
            class="rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-500"
            role="alert"
          >
            {{ stories.error }}
          </p>
        </div>
      </div>

      <footer
        class="border-t border-[var(--color-border-soft)] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-4"
      >
        <form class="flex flex-col gap-2 sm:flex-row" @submit.prevent="submit">
          <textarea
            v-model="input"
            autocomplete="off"
            class="field min-h-12 min-w-0 resize-none"
            rows="2"
            placeholder="Escribe lo que haces o dices…"
            @keydown.enter.exact.prevent="submit"
          />
          <div class="flex shrink-0 flex-row gap-2 sm:flex-col">
            <button type="submit" class="btn-primary flex-1 sm:flex-none" :disabled="stories.generating">Enviar</button>
            <button
              v-if="stories.generating"
              type="button"
              class="btn-ghost flex-1 sm:flex-none"
              @click="stories.stop()"
            >
              Parar
            </button>
          </div>
        </form>
      </footer>
    </section>

    <div
      class="hidden w-64 shrink-0 overflow-y-auto border-l border-[var(--color-border-soft)] p-4 lg:block"
    >
      <SceneStage
        :character-ids="stories.activeStory.characterIds"
        :active-character-id="lastDialogue?.characterId ?? null"
        :active-tag="lastDialogue?.tag ?? null"
        :background-id="currentBackground.id"
        :background-tag="currentBackground.tag"
      />
    </div>

    <Teleport to="body">
      <div
        v-if="storyPreferencesOpen"
        class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
        @click.self="storyPreferencesOpen = false"
        @keydown.esc.stop.prevent="storyPreferencesOpen = false"
      >
        <form
          class="w-full max-w-lg rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-5 shadow-2xl"
          @submit.prevent="saveStoryPreferences"
        >
          <h2 class="text-lg font-bold">Preferencias del protagonista</h2>
          <div class="mt-4 grid gap-4">
            <div>
              <label class="label" for="storyProtagonistPreferences">Preferencias de esta historia</label>
              <textarea
                id="storyProtagonistPreferences"
                v-model="storyPreferences"
                autocomplete="off"
                class="field min-h-32"
                autofocus
              />
            </div>
            <div>
              <label class="label" for="storyProtagonistPreferencesMode">Combinar con globales</label>
              <select
                id="storyProtagonistPreferencesMode"
                v-model="storyPreferencesMode"
                class="field"
              >
                <option value="append">Añadir</option>
                <option value="replace">Reemplazar</option>
              </select>
            </div>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="storyPreferencesOpen = false">Cancelar</button>
            <button type="submit" class="btn-primary">Guardar</button>
          </div>
        </form>
      </div>
    </Teleport>

    <LlmDebugDialog :trace="selectedDebugTrace" @close="selectedDebugTrace = null" />
  </div>
</template>
