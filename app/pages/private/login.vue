<script setup lang="ts">
definePageMeta({ layout: false })

const auth = useNsfwAuthStore()
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const localError = ref<string | null>(null)

await auth.refresh()

if (auth.isAuthenticated) {
  await navigateTo('/private')
}

const isBootstrap = computed(() => auth.mode === 'bootstrap')
const title = computed(() => (isBootstrap.value ? 'Crear administrador' : 'Entrar'))
const lede = computed(() =>
  isBootstrap.value
    ? 'No hay nadie todavía. La primera cuenta manda aquí dentro.'
    : 'Todo lo que hay aquí dentro es tuyo y solo tuyo.'
)
const submitLabel = computed(() => (isBootstrap.value ? 'Crear cuenta' : 'Entrar'))

async function onSubmit() {
  localError.value = null
  if (!username.value.trim() || !password.value.trim()) {
    localError.value = 'Completa usuario y contraseña'
    return
  }
  if (isBootstrap.value && password.value !== confirmPassword.value) {
    localError.value = 'Las contraseñas no coinciden'
    return
  }

  try {
    if (isBootstrap.value) {
      await auth.bootstrap(username.value, password.value)
    } else {
      await auth.login(username.value, password.value)
    }
    await navigateTo('/private')
  } catch {
    localError.value = auth.error
  }
}

useNsfwScope()
</script>

<template>
  <div
    class="nsfw-gate relative flex min-h-dvh items-center justify-center overflow-hidden bg-[var(--nsfw-canvas)] px-6 py-10"
  >
    <div
      class="pointer-events-none absolute inset-0"
      style="
        background:
          radial-gradient(120% 90% at 50% 118%, rgba(255, 117, 95, 0.16), transparent 62%),
          radial-gradient(90% 70% at 50% -25%, rgba(224, 180, 106, 0.07), transparent 60%);
      "
    />
    <div
      class="pointer-events-none absolute inset-0"
      style="box-shadow: inset 0 0 220px 60px rgba(0, 0, 0, 0.55)"
    />

    <div class="relative w-full max-w-[24.5rem]">
      <div class="mb-12 flex items-center justify-center gap-2.5">
        <span class="h-[5px] w-[5px] rounded-full bg-[var(--nsfw-accent)]" />
        <span class="font-serif text-[0.95rem] uppercase tracking-[0.32em] text-[var(--nsfw-muted)]">
          Mis historias
        </span>
      </div>

      <h1 class="mb-2.5 font-serif text-[2.6rem] leading-[1.1] text-[var(--nsfw-ink)]">
        {{ title }}
      </h1>
      <p class="mb-10 font-serif text-[1.05rem] italic leading-relaxed text-[var(--nsfw-muted)]">
        {{ lede }}
      </p>

      <form class="flex flex-col gap-6" @submit.prevent="onSubmit">
        <label class="block">
          <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Usuario</span>
          <input
            v-model="username"
            type="text"
            aria-label="Usuario"
            autocomplete="username"
            class="nsfw-underline"
            required
          >
        </label>

        <label class="block">
          <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Contraseña</span>
          <input
            v-model="password"
            type="password"
            aria-label="Contraseña"
            autocomplete="current-password"
            class="nsfw-underline tracking-[0.18em]"
            required
          >
        </label>

        <label v-if="isBootstrap" class="block">
          <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Confirmar contraseña</span>
          <input
            v-model="confirmPassword"
            type="password"
            aria-label="Confirmar contraseña"
            autocomplete="new-password"
            class="nsfw-underline tracking-[0.18em]"
            required
          >
        </label>

        <p v-if="localError" class="text-sm text-[var(--nsfw-danger)]" aria-live="polite">
          {{ localError }}
        </p>

        <button
          type="submit"
          class="nsfw-btn-primary mt-2 min-h-13 w-full"
          :disabled="auth.loading"
        >
          {{ auth.loading ? 'Entrando…' : submitLabel }}
        </button>
      </form>

      <div class="mt-14 flex items-center gap-3.5">
        <span class="h-px flex-1 bg-[var(--nsfw-hair)]" />
        <NuxtLink to="/" class="text-xs text-[var(--nsfw-faint)] hover:text-[var(--nsfw-ink)]">
          Volver a Mis historias
        </NuxtLink>
        <span class="h-px flex-1 bg-[var(--nsfw-hair)]" />
      </div>
    </div>
  </div>
</template>
