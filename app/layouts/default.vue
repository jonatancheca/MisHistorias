<script setup lang="ts">
const route = useRoute()
const privacy = usePrivacyStore()

const links = [
  { to: '/', label: 'Histórias' },
  { to: '/characters', label: 'Personajes' },
  { to: '/prompts', label: 'Prompts' },
  { to: '/settings', label: 'Ajustes' }
]

function isActive(to: string) {
  return to === '/' ? route.path === '/' || route.path.startsWith('/stories') : route.path.startsWith(to)
}

async function leavePrivateMode() {
  await privacy.deactivate()
}
</script>

<template>
  <div class="flex h-screen bg-[var(--color-surface)] text-[var(--color-fg)]">
    <aside
      class="flex w-56 shrink-0 flex-col border-r border-[var(--color-border-soft)] bg-[var(--color-surface-alt)] p-4"
    >
      <div class="mb-6 flex items-center gap-2">
        <NuxtLink to="/" class="flex items-center gap-2 text-lg font-bold">
          <span class="inline-block h-3 w-3 rounded-full bg-brand-500" />
          Mis historias
        </NuxtLink>
        <button
          v-if="privacy.isPrivate"
          type="button"
          class="rounded p-1 text-[var(--color-fg-muted)] transition hover:text-brand-600"
          aria-label="Salir del modo privado"
          title="Salir del modo privado"
          :disabled="privacy.switching"
          @click="leavePrivateMode"
        >
          <svg
            aria-hidden="true"
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </button>
      </div>

      <nav class="flex flex-1 flex-col gap-1">
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="rounded-lg px-3 py-2 text-sm font-medium transition"
          :class="
            isActive(link.to)
              ? 'bg-brand-500 text-white'
              : 'text-[var(--color-fg-muted)] hover:bg-brand-500/10 hover:text-brand-600'
          "
        >
          {{ link.label }}
        </NuxtLink>
      </nav>
    </aside>

    <main class="min-w-0 flex-1 overflow-y-auto">
      <slot />
    </main>
  </div>
</template>
