import { defineStore } from 'pinia'
import type {
  NsfwAuthStatus,
  NsfwCreateUserInput,
  NsfwPublicUser,
  NsfwSessionUser,
  NsfwUpdateUserInput
} from '../../shared/types/nsfw/auth.ts'

export const useNsfwAuthStore = defineStore('nsfwAuth', () => {
  const status = ref<NsfwAuthStatus | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const mode = computed(() => status.value?.mode ?? null)
  const user = computed(() => status.value?.user ?? null)
  const checked = computed(() => status.value !== null)
  const isAuthenticated = computed(() => Boolean(user.value))
  const isAdmin = computed(() => user.value?.role === 'admin')

  async function refresh() {
    loading.value = true
    error.value = null
    try {
      status.value = await $fetch<NsfwAuthStatus>('/api/private/auth/status')
    } catch (caught) {
      error.value = (caught as Error).message || 'No se pudo comprobar la sesión'
      status.value = null
    } finally {
      loading.value = false
    }
  }

  async function bootstrap(username: string, password: string) {
    loading.value = true
    error.value = null
    try {
      const result = await $fetch<{ user: NsfwSessionUser }>('/api/private/auth/bootstrap', {
        method: 'POST',
        body: { username, password }
      })
      status.value = { mode: 'session', user: result.user }
      return result.user
    } catch (caught) {
      error.value = extractErrorMessage(caught)
      throw caught
    } finally {
      loading.value = false
    }
  }

  async function login(username: string, password: string) {
    loading.value = true
    error.value = null
    try {
      const result = await $fetch<{ user: NsfwSessionUser }>('/api/private/auth/login', {
        method: 'POST',
        body: { username, password }
      })
      status.value = { mode: 'session', user: result.user }
      return result.user
    } catch (caught) {
      error.value = extractErrorMessage(caught)
      throw caught
    } finally {
      loading.value = false
    }
  }

  async function logout() {
    loading.value = true
    error.value = null
    try {
      await $fetch('/api/private/auth/logout', { method: 'POST' })
      status.value = { mode: 'login', user: null }
    } catch (caught) {
      error.value = extractErrorMessage(caught)
      throw caught
    } finally {
      loading.value = false
    }
  }

  async function listUsers() {
    const result = await $fetch<{ users: NsfwPublicUser[] }>('/api/private/admin/users')
    return result.users
  }

  async function createUser(input: NsfwCreateUserInput) {
    const result = await $fetch<{ user: NsfwPublicUser }>('/api/private/admin/users', {
      method: 'POST',
      body: input
    })
    return result.user
  }

  async function updateUser(userId: string, input: NsfwUpdateUserInput) {
    const result = await $fetch<{ user: NsfwPublicUser }>(`/api/private/admin/users/${userId}`, {
      method: 'PATCH',
      body: input
    })
    return result.user
  }

  return {
    status,
    loading,
    error,
    mode,
    user,
    checked,
    isAuthenticated,
    isAdmin,
    refresh,
    bootstrap,
    login,
    logout,
    listUsers,
    createUser,
    updateUser
  }
})

function extractErrorMessage(caught: unknown) {
  if (caught && typeof caught === 'object' && 'data' in caught) {
    const data = (caught as { data?: { statusMessage?: string; message?: string } }).data
    if (typeof data?.statusMessage === 'string') return data.statusMessage
    if (typeof data?.message === 'string') return data.message
  }
  if (caught instanceof Error && caught.message) return caught.message
  return 'Error inesperado'
}
