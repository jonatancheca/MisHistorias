<script setup lang="ts">
const route = useRoute()
const stories = useStoriesStore()
const characters = useCharactersStore()
const settings = useSettingsStore()

await Promise.all([characters.load(), stories.openStory(String(route.params.id))])

const input = ref('')
const scroller = ref<HTMLElement | null>(null)

const visibleMessages = computed(() =>
  stories.draft ? [...stories.messages, stories.draft] : stories.messages
)

const lastDialogue = computed(() => {
  for (let index = visibleMessages.value.length - 1; index >= 0; index -= 1) {
    const message = visibleMessages.value[index]!
    for (let cursor = message.segments.length - 1; cursor >= 0; cursor -= 1) {
      const segment = message.segments[cursor]!
      if (segment.type === 'dialogue' && segment.characterId) return segment
    }
  }
  return null
})

async function scrollToBottom() {
  await nextTick()
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
}

watch(visibleMessages, scrollToBottom, { deep: true, immediate: true })

async function submit() {
  const text = input.value
  if (!text.trim() || stories.streaming) return
  input.value = ''
  await stories.send(text)
}

const isEmpty = computed(() => stories.messages.length === 0 && !stories.streaming)
</script>

<template>
  <div v-if="!stories.activeStory" class="p-8">
    <p class="card text-sm">Historia no encontrada.</p>
  </div>

  <div v-else class="flex h-full min-h-0">
    <section class="flex min-w-0 flex-1 flex-col">
      <header
        class="flex items-center justify-between border-b border-[var(--color-border-soft)] px-6 py-4"
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
        <NuxtLink to="/" class="btn-ghost shrink-0">Historias</NuxtLink>
      </header>

      <div ref="scroller" class="flex-1 overflow-y-auto px-6 py-6">
        <div class="mx-auto max-w-3xl space-y-3">
          <div v-if="isEmpty" class="card text-sm text-[var(--color-fg-muted)]">
            La historia aún no ha empezado.
            <button type="button" class="text-brand-600 underline" @click="stories.generate()">
              Deja que el narrador abra la escena
            </button>
            o escribe tú el primer movimiento.
          </div>

          <MessageBubble
            v-for="message in visibleMessages"
            :key="message.id"
            :message="message"
            :editable="!stories.streaming"
            @edit="stories.updateMessage(message.id, $event)"
            @remove="stories.removeMessage(message.id)"
            @regenerate="stories.regenerateLast()"
          />

          <p v-if="stories.error" class="rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-500">
            {{ stories.error }}
          </p>
        </div>
      </div>

      <footer class="border-t border-[var(--color-border-soft)] p-4">
        <form class="flex gap-2" @submit.prevent="submit">
          <textarea
            v-model="input"
            class="field min-h-12 resize-none"
            rows="2"
            placeholder="Escribe lo que haces o dices…"
            @keydown.enter.exact.prevent="submit"
          />
          <div class="flex shrink-0 flex-col gap-2">
            <button type="submit" class="btn-primary" :disabled="stories.streaming">Enviar</button>
            <button
              v-if="stories.streaming"
              type="button"
              class="btn-ghost"
              @click="stories.stop()"
            >
              Parar
            </button>
            <button
              v-else
              type="button"
              class="btn-ghost"
              :disabled="stories.messages.length === 0"
              @click="stories.regenerateLast()"
            >
              Regenerar
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
  </div>
</template>
