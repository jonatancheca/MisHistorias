<script setup lang="ts">
const privacy = usePrivacyStore()

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  const editable = target.closest('input, textarea, select, [contenteditable]')
  return editable instanceof HTMLElement && editable.getAttribute('contenteditable') !== 'false'
}

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

async function onPrivateModeShortcut(event: KeyboardEvent) {
  if (!event.ctrlKey || !event.altKey || event.key.toLowerCase() !== 'p') return
  if (privacy.isPrivate || privacy.switching || isEditableTarget(event.target)) return

  event.preventDefault()
  await privacy.activate()
}

onMounted(() => {
  window.addEventListener('keydown', onSaveShortcut)
  window.addEventListener('keydown', onPrivateModeShortcut)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onSaveShortcut)
  window.removeEventListener('keydown', onPrivateModeShortcut)
})
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <AppUpdateBanner />
    <ConfirmDialog />
  </div>
</template>
