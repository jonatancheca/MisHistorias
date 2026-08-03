<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    busy: boolean
    label: string
    busyLabel: string
    zoneLabel: string
    multiple?: boolean
  }>(),
  { multiple: false }
)

const emit = defineEmits<{
  select: [files: File[]]
  error: [message: string]
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)

function chooseFile() {
  if (!props.busy) fileInput.value?.click()
}

function acceptFiles(files: File[]) {
  if (props.busy || files.length === 0) return
  const images = files.filter((file) => file.type.startsWith('image/'))
  if (images.length === 0) {
    emit('error', props.multiple ? 'Suelta uno o varios archivos de imagen.' : 'El archivo debe ser una imagen.')
    return
  }
  emit('select', props.multiple ? images : images.slice(0, 1))
}

function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  acceptFiles(Array.from(input.files ?? []))
  input.value = ''
}

function onDrop(event: DragEvent) {
  dragging.value = false
  acceptFiles(Array.from(event.dataTransfer?.files ?? []))
}

function onPaste(event: ClipboardEvent) {
  const file = Array.from(event.clipboardData?.items ?? [])
    .find((item) => item.type.startsWith('image/'))
    ?.getAsFile()
  if (!file) {
    emit('error', 'El portapapeles no contiene una imagen.')
    return
  }
  acceptFiles([file])
}
</script>

<template>
  <div
    role="group"
    tabindex="0"
    class="rounded-xl border border-dashed p-3 outline-none transition focus:ring-2 focus:ring-brand-500/20"
    :class="dragging ? 'border-brand-500 bg-brand-500/10' : 'border-[var(--color-border-soft)] hover:border-brand-400 focus:border-brand-500'"
    :aria-label="zoneLabel"
    @paste.prevent="onPaste"
    @dragenter.prevent="dragging = true"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
    @keydown.enter.prevent="chooseFile"
    @keydown.space.prevent="chooseFile"
  >
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      autocomplete="off"
      class="hidden"
      :multiple="multiple"
      @change="onFile"
    >
    <button type="button" class="btn-primary w-full" :disabled="busy" @click="chooseFile">
      {{ busy ? busyLabel : label }}
    </button>
    <p class="mt-2 text-center text-xs text-[var(--color-fg-muted)]">
      {{ multiple ? 'Arrastra varias, pega una con Ctrl+V o selecciona.' : 'Arrastra, pega con Ctrl+V o selecciona.' }}
    </p>
  </div>
</template>
