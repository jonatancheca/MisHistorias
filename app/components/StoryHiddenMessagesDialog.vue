<script setup lang="ts">
import type { LlmDebugTrace, Message } from '#shared/types'
import { storyOriginalText } from '~/lib/storyOriginalText'

const props = defineProps<{
  open: boolean
  messages: Message[]
  expandedIds: Set<string>
  debugEnabled?: boolean
  editable?: boolean
  debugTraces?: LlmDebugTrace[]
}>()
const emit = defineEmits<{
  close: []
  toggleOriginal: [id: string]
  edit: [message: Message]
  remove: [id: string]
  regenerate: [id: string]
  resend: [id: string]
  debug: [trace: LlmDebugTrace]
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
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--color-surface-alt)] p-2">
              <p class="text-sm text-[var(--color-fg-muted)]">
                {{ message.role === 'user' ? 'Usuario' : 'Narrador' }} · Contenido oculto
              </p>
              <StoryOriginalToggle
                v-if="!debugEnabled"
                :expanded="expandedIds.has(message.id)"
                :controls="`hidden-original-${message.id}`"
                @toggle="emit('toggleOriginal', message.id)"
              />
              <MessageActions
                v-else
                :message="message"
                :editable="editable"
                :debug-trace="debugTraces?.findLast(trace => trace.request.purpose !== 'compaction' && trace.responseMessageId === message.id)"
                :compaction-trace="debugTraces?.findLast(trace => trace.request.purpose === 'compaction' && trace.requestMessageId === message.id)"
                original-text-available
                :original-text-open="expandedIds.has(message.id)"
                :original-text-controls="`hidden-original-${message.id}`"
                @toggle-original="emit('toggleOriginal', message.id)"
                @edit="emit('edit', message)"
                @remove="emit('remove', message.id)"
                @regenerate="emit('regenerate', message.id)"
                @resend="emit('resend', message.id)"
                @debug="emit('debug', $event)"
              />
            </div>
            <StoryOriginalText
              v-if="expandedIds.has(message.id)"
              :id="`hidden-original-${message.id}`"
              :text="storyOriginalText(message, debugTraces)"
              class="mt-2"
            />
          </li>
        </ul>
      </section>
    </div>
  </Teleport>
</template>
