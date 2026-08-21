<script setup lang="ts">
/** Affordances de audio (TTS real fuera de alcance). Speech queda oculto al lector. */
const muted = ref(true)
const volume = ref(0.7)
</script>

<template>
  <section class="nsfw-card flex flex-wrap items-center gap-3 text-sm">
    <p class="text-xs uppercase tracking-wide text-[var(--nsfw-faint)]">Audio</p>
    <button
      type="button"
      class="nsfw-btn-ghost"
      :class="muted ? '' : 'text-[var(--nsfw-accent)]'"
      @click="muted = !muted"
    >
      {{ muted ? 'Silenciado' : 'Listo (sin TTS)' }}
    </button>
    <label class="flex min-w-[8rem] flex-1 items-center gap-2 text-xs text-[var(--nsfw-muted)]">
      Volumen
      <input
        v-model.number="volume"
        class="w-full accent-[var(--nsfw-accent)]"
        type="range"
        min="0"
        max="1"
        step="0.05"
        :disabled="muted"
      >
    </label>
    <p class="text-xs text-[var(--nsfw-faint)]">
      Speech anotado, no se renderiza. TTS próximamente.
    </p>
  </section>
</template>
