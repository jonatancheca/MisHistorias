<script setup lang="ts">
import type { Message } from '#shared/types'

const props = defineProps<{
  open: boolean
  messages: Message[]
  expandedIds: Set<string>
}>()
const emit = defineEmits<{
  close: []
  toggleOriginal: [id: string]
}>()

useDialogEscape(() => props.open, () => emit('close'))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      @click.self="emit('close')"
      @keydown.esc.stop.prevent="emit('close')"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-hidden-messages-title"
        class="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] shadow-2xl"
      >
        <header class="flex items-center justify-between gap-3 border-b border-[var(--color-border-soft)] p-5">
          <h2 id="story-hidden-messages-title" class="text-lg font-bold">Mensajes sin cuadro</h2>
          <button type="button" class="btn-ghost" aria-label="Cerrar mensajes sin cuadro" @click="emit('close')">Cerrar</button>
        </header>
        <ul class="min-h-0 space-y-3 overflow-y-auto p-5">
          <li v-for="message in messages" :key="message.id" :data-hidden-message-id="message.id" class="min-w-0">
            <div class="flex items-center justify-between gap-3 rounded-lg bg-[var(--color-surface-alt)] p-2">
              <p class="text-sm text-[var(--color-fg-muted)]">
                {{ message.role === 'user' ? 'Usuario' : 'Narrador' }} · Contenido oculto
              </p>
              <StoryOriginalToggle
                :expanded="expandedIds.has(message.id)"
                :controls="`hidden-original-${message.id}`"
                @toggle="emit('toggleOriginal', message.id)"
              />
            </div>
            <StoryOriginalText
              v-if="expandedIds.has(message.id)"
              :id="`hidden-original-${message.id}`"
              :text="message.raw"
              class="mt-2"
            />
          </li>
        </ul>
      </section>
    </div>
  </Teleport>
</template>
