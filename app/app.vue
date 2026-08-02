<script setup lang="ts">
function onSaveShortcut(event: KeyboardEvent) {
  if ((!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== 's') return
  if (!(event.target instanceof HTMLElement)) return

  const form = event.target.closest('form')
  if (!form) return
  const saveButton = Array.from(form.querySelectorAll<HTMLButtonElement>('button[type="submit"]'))
    .find((button) => button.textContent?.trim().includes('Guardar'))
  if (!saveButton || saveButton.disabled) return

  event.preventDefault()
  form.requestSubmit(saveButton)
}

onMounted(() => window.addEventListener('keydown', onSaveShortcut))
onBeforeUnmount(() => window.removeEventListener('keydown', onSaveShortcut))
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <ConfirmDialog />
  </div>
</template>
