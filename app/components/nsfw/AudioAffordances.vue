<script setup lang="ts">
/** Affordances de audio (TTS real fuera de alcance). Speech queda oculto al lector. */
const muted = ref(true)
const volume = ref(0.7)
</script>

<template>
  <section class="flex flex-col gap-2.5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="nsfw-eyebrow nsfw-eyebrow--dim !mb-0">Audio</p>
      <button
        type="button"
        class="nsfw-btn-text"
        :class="muted ? '' : '!text-[var(--nsfw-accent)]'"
        @click="muted = !muted"
      >
        {{ muted ? 'Silenciado' : 'Listo (sin TTS)' }}
      </button>
    </div>
    <label class="flex items-center gap-2.5 text-xs text-[var(--nsfw-faint)]">
      <span class="sr-only">Volumen</span>
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
    <p class="text-[0.7rem] leading-relaxed text-[var(--nsfw-dim)]">
      Speech anotado, no se renderiza. TTS próximamente.
    </p>
  </section>
</template>
