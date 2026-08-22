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
  { to: '/private/profile', label: 'Perfil' },
  { to: '/private/usage', label: 'Uso y latencia' },
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

/** En el player el chrome se retira: el rail colapsa a 64 px. */
const collapsed = computed(() => route.path.startsWith('/private/play/'))

const initial = computed(() => (auth.user?.username || '?').slice(0, 1).toLocaleUpperCase('es-ES'))
const roleLabel = computed(() => (auth.isAdmin ? 'Administrador' : 'Lector'))

function isActive(to: string) {
  if (to === '/private') return route.path === '/private'
  return route.path === to || route.path.startsWith(`${to}/`)
}

async function go(to: string, event?: Event) {
  event?.preventDefault()

  if (route.path === to && !route.fullPath.includes('?')) {
    const main = document.querySelector('.nsfw-shell main')
    main?.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }

  await navigateTo(to)
  await nextTick()
  const main = document.querySelector('.nsfw-shell main')
  main?.scrollTo({ top: 0 })
}

async function onLogout() {
  await auth.logout()
  await navigateTo('/private/login')
}

useNsfwScope()
</script>

<template>
  <div class="nsfw-shell flex min-h-dvh bg-[var(--nsfw-canvas)] text-[var(--nsfw-ink)]">
    <aside
      class="nsfw-rail relative z-50 hidden shrink-0 flex-col border-r border-[var(--nsfw-hair)] pt-7 pb-5 lg:flex"
      :class="collapsed ? 'w-16 items-center gap-6' : 'w-[252px]'"
    >
      <template v-if="collapsed">
        <a href="/private" aria-label="Inicio" @click="go('/private', $event)">
          <span class="block h-[5px] w-[5px] rounded-full bg-[var(--nsfw-accent)]" />
        </a>
        <span class="h-px w-5 bg-[var(--nsfw-line)]" />
        <a
          v-for="link in links.filter((item) => item.to !== '/private/create')"
          :key="`c-${link.to}`"
          :href="link.to"
          class="text-[0.66rem] uppercase tracking-[0.22em] text-[var(--nsfw-faint)] transition hover:text-[var(--nsfw-ink)] [writing-mode:vertical-rl]"
          @click="go(link.to, $event)"
        >
          {{ link.label }}
        </a>
        <span class="flex-1" />
        <a
          href="/private/profile"
          class="nsfw-avatar is-gold h-7 w-7 text-xs"
          :title="auth.user?.username"
          @click="go('/private/profile', $event)"
        >
          {{ initial }}
        </a>
      </template>

      <template v-else>
        <a
          href="/private"
          class="mb-7 flex items-center gap-2.5 px-6"
          @click="go('/private', $event)"
        >
          <span class="h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--nsfw-accent)]" />
          <span class="font-serif text-xs uppercase tracking-[0.3em] text-[var(--nsfw-muted)]">
            Mis historias
          </span>
        </a>

        <nav class="flex flex-col">
          <a
            v-for="link in links"
            :key="link.to"
            :href="link.to"
            class="nsfw-nav-link"
            :class="isActive(link.to) ? 'is-active' : ''"
            :aria-current="isActive(link.to) ? 'page' : undefined"
            @click="go(link.to, $event)"
          >
            {{ link.label }}
          </a>
        </nav>

        <div class="mt-8">
          <p class="nsfw-nav-group">Studio</p>
          <a
            v-for="link in studioLinks"
            :key="link.to"
            :href="link.to"
            class="nsfw-nav-sub"
            :class="isActive(link.to) ? 'is-active' : ''"
            @click="go(link.to, $event)"
          >
            {{ link.label }}
          </a>
        </div>

        <div class="mt-6">
          <p class="nsfw-nav-group">Cuenta</p>
          <a
            v-for="link in accountLinks"
            :key="link.to"
            :href="link.to"
            class="nsfw-nav-sub"
            :class="isActive(link.to) ? 'is-active' : ''"
            @click="go(link.to, $event)"
          >
            {{ link.label }}
          </a>
        </div>

        <div v-if="auth.isAdmin" class="mt-6">
          <p class="nsfw-nav-group">Administrar</p>
          <a
            v-for="link in adminLinks"
            :key="link.to"
            :href="link.to"
            class="nsfw-nav-sub"
            :class="isActive(link.to) ? 'is-active' : ''"
            @click="go(link.to, $event)"
          >
            {{ link.label }}
          </a>
        </div>

        <div class="flex-1" />

        <div
          class="mx-4 flex items-center gap-3 border-t border-[var(--nsfw-hair)] px-2 pt-4"
        >
          <a
            href="/private/profile"
            class="nsfw-avatar is-gold"
            @click="go('/private/profile', $event)"
          >
            {{ initial }}
          </a>
          <div class="min-w-0 flex-1">
            <p class="truncate text-[0.8rem] text-[var(--nsfw-ink)]">{{ auth.user?.username }}</p>
            <p class="text-[0.7rem] text-[var(--nsfw-faint)]">{{ roleLabel }}</p>
          </div>
          <button
            type="button"
            class="nsfw-btn-text text-[0.72rem] hover:text-[var(--nsfw-accent)]"
            @click="onLogout"
          >
            Salir
          </button>
        </div>
      </template>
    </aside>

    <div class="relative z-0 flex min-w-0 flex-1 flex-col">
      <header
        class="relative z-40 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--nsfw-hair)] px-4 py-3 lg:hidden"
      >
        <a href="/private" class="flex items-center gap-2" @click="go('/private', $event)">
          <span class="h-[5px] w-[5px] rounded-full bg-[var(--nsfw-accent)]" />
          <span class="font-serif text-[0.7rem] uppercase tracking-[0.28em] text-[var(--nsfw-muted)]">
            Mis historias
          </span>
        </a>
        <div class="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          <a
            v-for="link in accountLinks"
            :key="`m-acc-${link.to}`"
            :href="link.to"
            class="nsfw-btn-text"
            @click="go(link.to, $event)"
          >
            {{ link.label }}
          </a>
          <a
            v-if="auth.isAdmin"
            href="/private/admin/users"
            class="nsfw-btn-text"
            @click="go('/private/admin/users', $event)"
          >
            Usuarios
          </a>
          <a
            v-for="link in studioLinks"
            :key="`m-studio-${link.to}`"
            :href="link.to"
            class="nsfw-btn-text"
            @click="go(link.to, $event)"
          >
            {{ link.label }}
          </a>
          <button type="button" class="nsfw-btn-text" @click="onLogout">Salir</button>
        </div>
      </header>

      <main class="min-h-0 flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
        <slot />
      </main>

      <nav
        class="nsfw-mobile-rail fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 border-t border-[var(--nsfw-hair)] bg-[var(--nsfw-canvas)] px-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] lg:hidden"
      >
        <a
          v-for="link in links"
          :key="`mobile-${link.to}`"
          :href="link.to"
          class="rounded-lg py-2 text-center font-serif text-sm transition"
          :class="isActive(link.to) ? 'text-[var(--nsfw-accent)]' : 'text-[var(--nsfw-muted)]'"
          @click="go(link.to, $event)"
        >
          {{ link.label }}
        </a>
      </nav>
    </div>
  </div>
</template>
