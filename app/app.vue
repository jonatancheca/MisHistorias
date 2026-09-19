<script setup lang="ts">
const privacy = usePrivacyStore()
const access = useAccessStore()
await access.load()

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
  if (event.repeat || privacy.switching || isEditableTarget(event.target)) return

  event.preventDefault()
  await (privacy.isPrivateMode ? privacy.deactivate() : privacy.activate())
}

async function onDemoModeShortcut(event: KeyboardEvent) {
  if (!event.ctrlKey || !event.altKey || event.key.toLowerCase() !== 'd') return
  if (privacy.switching || isEditableTarget(event.target)) return

  event.preventDefault()
  await privacy.toggleDemo()
}

onMounted(() => {
  window.addEventListener('keydown', onSaveShortcut)
  window.addEventListener('keydown', onPrivateModeShortcut)
  window.addEventListener('keydown', onDemoModeShortcut)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onSaveShortcut)
  window.removeEventListener('keydown', onPrivateModeShortcut)
  window.removeEventListener('keydown', onDemoModeShortcut)
})
</script>

<template>
  <div v-if="access.blocked" class="flex min-h-screen items-center justify-center bg-[var(--color-bg)] p-6">
    <section class="panel max-w-lg p-6 text-center">
      <h1 class="text-xl font-bold">Acceso protegido requerido</h1>
      <p class="mt-3 text-sm text-[var(--color-fg-muted)]">
        Abre Mis Historias mediante la aplicación protegida por Cloudflare Access.
      </p>
    </section>
  </div>
  <div v-else>
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <AppUpdateBanner />
    <ConfirmDialog />
  </div>
</template>
