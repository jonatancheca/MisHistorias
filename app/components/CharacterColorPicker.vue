<script setup lang="ts">
import { CHARACTER_COLORS } from '~/lib/colors'

defineProps<{ id: string }>()
const color = defineModel<string>({ required: true })
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <input
      :id="id"
      v-model="color"
      type="color"
      autocomplete="off"
      class="h-9 w-14 cursor-pointer rounded border border-[var(--color-border-soft)] bg-transparent"
    >
    <button
      v-for="swatch in CHARACTER_COLORS"
      :key="swatch"
      type="button"
      class="h-7 w-7 rounded-full border-2 transition"
      :style="{
        backgroundColor: swatch,
        borderColor: color === swatch ? 'var(--color-fg)' : 'transparent'
      }"
      :aria-label="`Usar color ${swatch}`"
      :aria-pressed="color === swatch"
      @click="color = swatch"
    />
  </div>
</template>
