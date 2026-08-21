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

onMounted(() => {
  document.documentElement.classList.add('nsfw-scope')
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('nsfw-scope')
})
</script>

<template>
  <div class="nsfw-gate flex min-h-dvh items-center justify-center bg-[var(--nsfw-canvas)] px-4 py-8">
    <div class="w-full max-w-[28rem] rounded-2xl border border-[var(--nsfw-line)] bg-[var(--nsfw-raised)] p-6 shadow-2xl">
      <p class="mb-2 text-xs uppercase tracking-[0.2em] text-[var(--nsfw-faint)]">Acceso privado</p>
      <h1 class="mb-2 font-serif text-3xl text-[var(--nsfw-ink)]">{{ title }}</h1>
      <p class="mb-6 text-sm leading-relaxed text-[var(--nsfw-muted)]">
        {{
          isBootstrap
            ? 'No hay usuarios todavía. Crea la cuenta de administrador.'
            : 'Introduce usuario o email y contraseña para continuar.'
        }}
      </p>

      <form class="space-y-4" @submit.prevent="onSubmit">
        <label class="block">
          <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Usuario o email</span>
          <input
            v-model="username"
            type="text"
            autocomplete="username"
            class="nsfw-input w-full"
            required
          >
        </label>

        <label class="block">
          <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Contraseña</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            class="nsfw-input w-full"
            required
          >
        </label>

        <label v-if="isBootstrap" class="block">
          <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Confirmar contraseña</span>
          <input
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            class="nsfw-input w-full"
            required
          >
        </label>

        <p v-if="localError" class="text-sm text-[var(--nsfw-danger)]" aria-live="polite">
          {{ localError }}
        </p>

        <button type="submit" class="nsfw-btn-primary w-full" :disabled="auth.loading">
          {{ auth.loading ? 'Entrando…' : submitLabel }}
        </button>
      </form>

      <NuxtLink to="/" class="mt-6 inline-block text-sm text-[var(--nsfw-muted)] hover:text-[var(--nsfw-ink)]">
        Volver a Mis historias
      </NuxtLink>
    </div>
  </div>
</template>
