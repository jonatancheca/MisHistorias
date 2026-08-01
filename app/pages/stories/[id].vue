<script setup lang="ts">
const route = useRoute()
const stories = useStoriesStore()
const characters = useCharactersStore()
const settings = useSettingsStore()
const confirmDialog = useConfirmStore()
const {
  hidden: mobileChromeHidden,
  hide: hideMobileChrome,
  show: showMobileChrome
} = useMobileChrome()

await Promise.all([characters.load(), settings.load(), stories.openStory(String(route.params.id))])

const input = ref('')
const scroller = ref<HTMLElement | null>(null)
const storyPreferencesOpen = ref(false)
const storyPreferences = ref('')
const storyPreferencesMode = ref<'append' | 'replace'>('append')
let lastScrollTop = 0
let autoScrollTarget: number | null = null
let accumulatedScroll = 0
let desktopMedia: MediaQueryList | null = null

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

watch(() => stories.messages, scrollToBottom, { deep: true, immediate: true })

async function submit() {
  const text = input.value
  if (!text.trim() || stories.generating) return
  input.value = ''
  await stories.send(text)
}

const isEmpty = computed(() => stories.messages.length === 0 && !stories.generating)

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

function onBreakpointChange(event: MediaQueryListEvent) {
  if (event.matches) showMobileChrome()
}

onMounted(() => {
  desktopMedia = window.matchMedia('(min-width: 640px)')
  desktopMedia.addEventListener('change', onBreakpointChange)
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
          <div v-if="isEmpty" class="card text-sm text-[var(--color-fg-muted)]">
            La historia aún no ha empezado.
            <button type="button" class="text-brand-600 underline" @click="stories.generate()">
              Deja que el narrador abra la escena
            </button>
            o escribe tú el primer movimiento.
          </div>

          <MessageBubble
            v-for="message in stories.messages"
            :key="message.id"
            :message="message"
            :editable="!stories.generating"
            @edit="stories.updateMessage(message.id, $event)"
            @remove="removeMessage(message.id)"
            @regenerate="regenerateFrom(message.id)"
          />

          <p v-if="stories.error" class="rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-500">
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
  </div>
</template>
