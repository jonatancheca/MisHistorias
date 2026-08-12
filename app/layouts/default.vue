<script setup lang="ts">
const route = useRoute()
const privacy = usePrivacyStore()
const { hidden: mobileChromeHidden } = useMobileChrome()
const isStoryView = computed(() => route.path.startsWith('/stories/') && route.path !== '/stories/new')

const links = [
  { to: '/', label: 'Histórias' },
  { to: '/characters', label: 'Personajes' },
  { to: '/backgrounds', label: 'Fondos' },
  { to: '/prompts', label: 'Prompts' },
  { to: '/settings', label: 'Ajustes' }
]

function isActive(to: string) {
  return to === '/' ? route.path === '/' || route.path.startsWith('/stories') : route.path.startsWith(to)
}

function iconFor(to: string) {
  if (to === '/') return 'book'
  if (to === '/characters') return 'users'
  if (to === '/backgrounds') return 'image'
  if (to === '/prompts') return 'document'
  return 'settings'
}

async function leavePrivateMode() {
  await privacy.deactivate()
}
</script>

<template>
  <div class="flex h-dvh min-h-0 flex-col bg-[var(--color-surface)] text-[var(--color-fg)] sm:flex-row">
    <aside
      id="app-navigation"
      class="flex w-full shrink-0 flex-col border-b border-[var(--color-border-soft)] bg-[var(--color-surface-alt)] px-3 transition-[max-height,opacity,padding,transform,width] duration-200 sm:max-h-none sm:translate-y-0 sm:overflow-visible sm:border-r sm:border-b-0 sm:opacity-100"
      :class="[
        mobileChromeHidden
          ? 'max-h-0 -translate-y-2 overflow-hidden border-b-0 py-0 opacity-0'
          : 'max-h-32 translate-y-0 py-3 opacity-100',
        isStoryView ? 'sm:w-16 sm:px-2 sm:py-4' : 'sm:w-56 sm:p-4'
      ]"
    >
      <div
        class="mb-3 flex items-center gap-2 sm:mb-6"
        :class="isStoryView ? 'pr-12 sm:hidden' : ''"
      >
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

      <nav class="grid grid-cols-5 gap-1 sm:flex sm:flex-1 sm:flex-col">
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="flex min-w-0 items-center justify-center gap-2 rounded-lg px-1 py-2 text-xs font-medium transition sm:text-sm"
          :aria-label="link.label"
          :title="link.label"
          :class="[
            isStoryView ? 'sm:px-2' : 'sm:justify-start sm:px-3',
            isActive(link.to)
              ? 'bg-brand-500 text-white'
              : 'text-[var(--color-fg-muted)] hover:bg-brand-500/10 hover:text-brand-600'
          ]"
        >
          <svg
            v-if="iconFor(link.to) === 'book'"
            aria-hidden="true"
            class="h-5 w-5 shrink-0 sm:h-4 sm:w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M4 5a3 3 0 0 1 3-3h13v18H7a3 3 0 0 0-3 3V5Z" />
            <path d="M7 20a3 3 0 0 0-3 3h16M8 6h8m-8 4h8" />
          </svg>
          <svg
            v-else-if="iconFor(link.to) === 'users'"
            aria-hidden="true"
            class="h-5 w-5 shrink-0 sm:h-4 sm:w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <svg
            v-else-if="iconFor(link.to) === 'image'"
            aria-hidden="true"
            class="h-5 w-5 shrink-0 sm:h-4 sm:w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
          <svg
            v-else-if="iconFor(link.to) === 'document'"
            aria-hidden="true"
            class="h-5 w-5 shrink-0 sm:h-4 sm:w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
            <path d="M14 2v6h6M8 13h8m-8 4h8" />
          </svg>
          <svg
            v-else
            aria-hidden="true"
            class="h-5 w-5 shrink-0 sm:h-4 sm:w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M12 3v2m0 14v2M3 12h2m14 0h2m-3.36-6.36-1.42 1.42M8.78 16.64l-1.42 1.42m0-12.84 1.42 1.42m7.86 7.86 1.42 1.42" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span
            class="hidden min-w-0 truncate"
            :class="isStoryView ? '' : 'sm:inline'"
          >{{ link.label }}</span>
        </NuxtLink>
      </nav>
    </aside>

    <main class="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <slot />
    </main>
  </div>
</template>
