<script setup lang="ts">
const route = useRoute()
const auth = useNsfwAuthStore()

const links = [
  { to: '/private', label: 'Inicio' },
  { to: '/private/hub', label: 'Hub' },
  { to: '/private/create', label: 'Crear' },
  { to: '/private/library', label: 'Biblioteca' }
]

const accountLinks = [
  { to: '/private/usage', label: 'Usage' },
  { to: '/private/profile', label: 'Perfil' },
  { to: '/private/legacy', label: 'Legado' }
]

const studioLinks = [
  { to: '/private/studio/characters', label: 'Personajes' },
  { to: '/private/studio/places', label: 'Lugares' },
  { to: '/private/studio/experiences', label: 'Experiences' }
]

const adminLinks = [
  { to: '/private/admin/users', label: 'Usuarios' },
  { to: '/private/admin/console', label: 'Consola' }
]

function isActive(to: string) {
  if (to === '/private') return route.path === '/private'
  return route.path.startsWith(to)
}

async function onLogout() {
  await auth.logout()
  await navigateTo('/private/login')
}

onMounted(() => {
  document.documentElement.classList.add('nsfw-scope')
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('nsfw-scope')
})
</script>

<template>
  <div class="nsfw-shell flex min-h-dvh bg-[var(--nsfw-canvas)] text-[var(--nsfw-ink)]">
    <aside
      class="hidden w-[260px] shrink-0 flex-col border-r border-[var(--nsfw-line)] bg-[var(--nsfw-surface)] p-4 lg:flex"
    >
      <NuxtLink to="/private" class="mb-8 font-serif text-xl tracking-tight text-[var(--nsfw-ink)]">
        Mis historias
      </NuxtLink>

      <nav class="flex flex-1 flex-col gap-1">
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="rounded-xl px-3 py-2 text-sm transition"
          :class="
            isActive(link.to)
              ? 'bg-[var(--nsfw-soft)] text-[var(--nsfw-accent)]'
              : 'text-[var(--nsfw-muted)] hover:bg-[var(--nsfw-soft)] hover:text-[var(--nsfw-ink)]'
          "
        >
          {{ link.label }}
        </NuxtLink>
      </nav>

      <div class="mb-4 border-t border-[var(--nsfw-line)] pt-4">
        <p class="mb-2 text-xs uppercase tracking-wide text-[var(--nsfw-faint)]">Cuenta</p>
        <NuxtLink
          v-for="link in accountLinks"
          :key="link.to"
          :to="link.to"
          class="block rounded-xl px-3 py-2 text-sm text-[var(--nsfw-muted)] hover:bg-[var(--nsfw-soft)] hover:text-[var(--nsfw-ink)]"
        >
          {{ link.label }}
        </NuxtLink>
      </div>

      <div class="mb-4 border-t border-[var(--nsfw-line)] pt-4">
        <p class="mb-2 text-xs uppercase tracking-wide text-[var(--nsfw-faint)]">Studio</p>
        <NuxtLink
          v-for="link in studioLinks"
          :key="link.to"
          :to="link.to"
          class="block rounded-xl px-3 py-2 text-sm text-[var(--nsfw-muted)] hover:bg-[var(--nsfw-soft)] hover:text-[var(--nsfw-ink)]"
        >
          {{ link.label }}
        </NuxtLink>
      </div>

      <div v-if="auth.isAdmin" class="mb-4 border-t border-[var(--nsfw-line)] pt-4">
        <p class="mb-2 text-xs uppercase tracking-wide text-[var(--nsfw-faint)]">Admin</p>
        <NuxtLink
          v-for="link in adminLinks"
          :key="link.to"
          :to="link.to"
          class="block rounded-xl px-3 py-2 text-sm text-[var(--nsfw-muted)] hover:bg-[var(--nsfw-soft)] hover:text-[var(--nsfw-ink)]"
        >
          {{ link.label }}
        </NuxtLink>
      </div>

      <div class="border-t border-[var(--nsfw-line)] pt-4 text-sm">
        <p class="truncate text-[var(--nsfw-muted)]">{{ auth.user?.username }}</p>
        <button type="button" class="nsfw-btn-ghost mt-2 w-full" @click="onLogout">Salir</button>
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="flex items-center justify-between gap-2 border-b border-[var(--nsfw-line)] px-3 py-2 lg:hidden"
      >
        <NuxtLink to="/private" class="font-serif text-lg">Mis historias</NuxtLink>
        <div class="flex flex-wrap items-center gap-1">
          <NuxtLink
            v-for="link in accountLinks"
            :key="`m-acc-${link.to}`"
            :to="link.to"
            class="nsfw-btn-ghost px-2 text-xs"
          >
            {{ link.label }}
          </NuxtLink>
          <NuxtLink
            v-if="auth.isAdmin"
            to="/private/admin/users"
            class="nsfw-btn-ghost px-2 text-xs"
          >
            Usuarios
          </NuxtLink>
          <button type="button" class="nsfw-btn-ghost px-2 text-xs" @click="onLogout">
            Salir
          </button>
        </div>
      </header>

      <main class="min-h-0 flex-1 overflow-y-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
        <slot />
      </main>

      <nav
        class="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 gap-1 border-t border-[var(--nsfw-line)] bg-[var(--nsfw-surface)] px-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] lg:hidden"
      >
        <NuxtLink
          v-for="link in links"
          :key="`mobile-${link.to}`"
          :to="link.to"
          class="rounded-xl px-2 py-2 text-center text-xs"
          :class="
            isActive(link.to)
              ? 'text-[var(--nsfw-accent)]'
              : 'text-[var(--nsfw-muted)]'
          "
        >
          {{ link.label }}
        </NuxtLink>
      </nav>
    </div>
  </div>
</template>
