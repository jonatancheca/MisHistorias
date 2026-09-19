<script setup lang="ts">
const route = useRoute()
const mainScroller = ref<HTMLElement | null>(null)
const {
  hidden: mobileChromeHidden,
  atTop: mobileChromeAtTop,
  hide: hideMobileChrome,
  show: showMobileChrome,
  setAtTop: setMobileChromeAtTop
} = useMobileChrome()
const isStoryView = computed(() => route.path.startsWith('/stories/') && route.path !== '/stories/new')
let lastMainScrollTop = 0
let accumulatedMainScroll = 0
let desktopMedia: MediaQueryList | null = null

const links = computed(() => [
  { to: '/', label: 'Historias' },
  { to: '/characters', label: 'Personajes' },
  { to: '/backgrounds', label: 'Fondos' },
  { to: '/sounds', label: 'Sonidos' },
  { to: '/settings', label: 'Ajustes' }
])

function isActive(to: string) {
  return to === '/' ? route.path === '/' || route.path.startsWith('/stories') : route.path.startsWith(to)
}

function iconFor(to: string) {
  if (to === '/') return 'book'
  if (to === '/characters') return 'users'
  if (to === '/backgrounds') return 'image'
  if (to === '/sounds') return 'sound'
  return 'settings'
}

function syncMainScroll() {
  if (isStoryView.value || !mainScroller.value) return

  const current = mainScroller.value.scrollTop
  const delta = current - lastMainScrollTop
  lastMainScrollTop = current

  if (window.innerWidth >= 640) {
    accumulatedMainScroll = 0
    showMobileChrome()
    return
  }

  const atTop = current <= 8
  setMobileChromeAtTop(atTop)
  if (atTop) {
    accumulatedMainScroll = 0
    showMobileChrome()
    return
  }

  if (Math.sign(delta) !== Math.sign(accumulatedMainScroll)) accumulatedMainScroll = 0
  accumulatedMainScroll += delta
  if (accumulatedMainScroll >= 12) {
    hideMobileChrome()
    accumulatedMainScroll = 0
  } else if (accumulatedMainScroll <= -4) {
    showMobileChrome()
    accumulatedMainScroll = 0
  }
}

async function resetMainScrollTracking() {
  await nextTick()
  if (isStoryView.value || !mainScroller.value) return
  lastMainScrollTop = mainScroller.value.scrollTop
  accumulatedMainScroll = 0
  setMobileChromeAtTop(lastMainScrollTop <= 8)
  showMobileChrome()
}

function onBreakpointChange(event: MediaQueryListEvent) {
  if (event.matches) {
    accumulatedMainScroll = 0
    return
  }
  void resetMainScrollTracking()
}

watch(() => route.fullPath, resetMainScrollTracking)

onMounted(() => {
  desktopMedia = window.matchMedia('(min-width: 640px)')
  desktopMedia.addEventListener('change', onBreakpointChange)
  void resetMainScrollTracking()
})

onBeforeUnmount(() => desktopMedia?.removeEventListener('change', onBreakpointChange))
</script>

<template>
  <div class="app-frame flex h-dvh min-h-0 flex-col text-[var(--color-fg)] sm:flex-row">
    <aside
      id="app-navigation"
      class="app-sidebar z-30 flex w-full shrink-0 flex-col border-b px-3 transition-[max-height,opacity,padding,transform,width] duration-200 sm:max-h-none sm:translate-y-0 sm:overflow-visible sm:border-r sm:border-b-0 sm:opacity-100"
      :class="[
        mobileChromeHidden
          ? 'max-h-0 -translate-y-2 overflow-hidden border-b-0 py-0 opacity-0'
          : mobileChromeAtTop
            ? 'max-h-32 translate-y-0 py-3 opacity-100'
            : 'max-h-20 translate-y-0 py-3 opacity-100',
        isStoryView ? 'sm:w-[4.5rem] sm:px-2.5 sm:py-5' : 'sm:w-64 sm:p-5'
      ]"
    >
      <div
        data-testid="app-brand"
        class="flex items-center gap-2.5 transition-[max-height,margin,opacity,transform] duration-200 sm:mb-8 sm:max-h-none sm:translate-y-0 sm:overflow-visible sm:opacity-100"
        :class="[
          mobileChromeAtTop
            ? 'mb-3 max-h-12 translate-y-0 opacity-100'
            : 'mb-0 max-h-0 -translate-y-2 overflow-hidden opacity-0',
          isStoryView ? 'pr-12 sm:hidden' : ''
        ]"
      >
        <NuxtLink to="/" class="group flex min-w-0 items-center gap-3">
          <span class="brand-mark flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 via-brand-600 to-brand-800 text-white transition group-hover:-rotate-3 group-hover:scale-105">
            <svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H20v17H7.5A3.5 3.5 0 0 0 4 22.5v-17Z" />
              <path d="M8 7h8M8 11h6" />
            </svg>
          </span>
          <span class="min-w-0">
            <span class="block truncate text-[0.68rem] font-bold tracking-[0.16em] text-brand-600 uppercase">Tu universo</span>
            <span class="block truncate text-lg font-bold tracking-[-0.03em]">Mis historias</span>
          </span>
        </NuxtLink>
      </div>

      <nav
        data-testid="app-navigation-links"
        class="grid min-w-0 grid-cols-5 gap-1 sm:flex sm:flex-1 sm:flex-col sm:gap-1.5"
      >
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="nav-link flex min-w-0 items-center justify-center gap-2.5 rounded-xl px-1 py-2.5 text-xs font-semibold transition-[background-color,color,transform,box-shadow] duration-200 sm:text-sm"
          :aria-label="link.label"
          :title="link.label"
          :class="[
            isStoryView ? 'sm:px-2' : 'sm:justify-start sm:px-3.5',
            isActive(link.to)
              ? 'nav-link-active bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow-[0_8px_20px_color-mix(in_srgb,var(--color-brand-600)_22%,transparent)]'
              : 'text-[var(--color-fg-muted)] hover:translate-x-0.5 hover:bg-brand-500/10 hover:text-brand-600'
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
            v-else-if="iconFor(link.to) === 'sound'"
            aria-hidden="true"
            class="h-5 w-5 shrink-0 sm:h-4 sm:w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
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
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0L6.2 6.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span
            class="hidden min-w-0 truncate"
            :class="isStoryView ? '' : 'sm:inline'"
          >{{ link.label }}</span>
        </NuxtLink>
      </nav>

      <div
        v-if="!isStoryView"
        class="mt-5 hidden rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface-elevated)] p-3.5 sm:block"
      >
        <p class="text-[0.65rem] font-bold tracking-[0.13em] text-brand-600 uppercase">Espacio creativo</p>
        <p class="mt-1 text-xs leading-relaxed text-[var(--color-fg-muted)]">
          Personajes, escenas y relatos en un solo lugar.
        </p>
      </div>
    </aside>

    <main
      ref="mainScroller"
      class="app-main min-h-0 min-w-0 flex-1 overflow-y-auto"
      :class="isStoryView ? 'z-40 sm:z-auto' : ''"
      @scroll.passive="syncMainScroll"
    >
      <slot />
    </main>
  </div>
</template>
