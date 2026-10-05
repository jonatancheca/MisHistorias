<script setup lang="ts">
const props = defineProps<{
  open: boolean
  characterIds: string[]
  absentCharacterIds: string[]
  characterNames: Record<string, string>
  protagonistName: string
  disabled: boolean
  error: string | null
}>()
const emit = defineEmits<{ close: []; change: [characterId: string, present: boolean] }>()
const characters = useCharactersStore()
const panel = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
let previousFocus: HTMLElement | null = null
watch(() => props.open, async (open) => {
  if (!open) {
    if (previousFocus?.getClientRects().length) previousFocus.focus()
    else document.querySelector<HTMLButtonElement>('[data-testid="story-tools-toggle"]')?.focus()
    return
  }
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  await nextTick()
  closeButton.value?.focus()
})
useDialogEscape(() => props.open, () => emit('close'))
function onTab(event: KeyboardEvent) {
  const buttons = [...(panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
  const first = buttons[0]
  const last = buttons.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 sm:p-6" @click.self="emit('close')">
      <section ref="panel" role="dialog" aria-modal="true" aria-labelledby="story-presence-title" class="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-4 shadow-2xl sm:p-5" @keydown.tab="onTab">
        <header class="flex items-center justify-between gap-3">
          <h2 id="story-presence-title" class="text-lg font-bold">Personajes en escena</h2>
          <button ref="closeButton" type="button" class="btn-ghost" aria-label="Cerrar personajes" @click="emit('close')">Cerrar</button>
        </header>
        <p class="mt-2 text-sm text-[var(--color-fg-muted)]">Cambios para la continuación actual. El historial conserva la presencia de cada momento.</p>
        <p v-if="error" class="mt-2 text-sm text-red-500" role="alert">{{ error }}</p>
        <div class="mt-4 min-h-0 space-y-2 overflow-y-auto">
          <div class="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--color-border-soft)] p-3">
            <span class="min-w-0 break-words font-semibold">{{ protagonistName }} <span class="block text-xs font-normal text-[var(--color-fg-muted)]">Protagonista</span></span>
            <span class="shrink-0 text-xs text-[var(--color-fg-muted)]">Siempre presente</span>
          </div>
          <div v-for="id in characterIds" :key="id" class="flex min-w-0 items-center gap-3 rounded-xl border border-[var(--color-border-soft)] p-3">
            <img v-if="characters.urlFor(characters.resolveImage(id, null, null)?.id)" :src="characters.urlFor(characters.resolveImage(id, null, null)?.id)!" alt="" class="h-14 w-10 shrink-0 rounded-lg object-contain" :class="absentCharacterIds.includes(id) ? 'opacity-40 grayscale' : ''">
            <span class="min-w-0 flex-1 break-words font-semibold">{{ characterNames[id] ?? characters.byId(id)?.name ?? 'Personaje' }}</span>
            <button type="button" role="switch" :aria-checked="!absentCharacterIds.includes(id)" :aria-label="'Presencia de ' + (characterNames[id] ?? characters.byId(id)?.name ?? 'Personaje')" :disabled="disabled" class="btn-ghost min-h-11 shrink-0" :class="!absentCharacterIds.includes(id) ? 'bg-brand-500/15 text-brand-600' : ''" @click="emit('change', id, absentCharacterIds.includes(id))">
              {{ absentCharacterIds.includes(id) ? 'Ausente' : 'Presente' }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
