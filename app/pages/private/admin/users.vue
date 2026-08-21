<script setup lang="ts">
import type { NsfwPublicUser, NsfwUserRole } from '../../../../shared/types/nsfw/auth.ts'

definePageMeta({ layout: 'private' })

const auth = useNsfwAuthStore()
const users = ref<NsfwPublicUser[]>([])
const loading = ref(true)
const message = ref<string | null>(null)
const error = ref<string | null>(null)

const createForm = reactive({
  username: '',
  password: '',
  role: 'user' as NsfwUserRole
})

const editId = ref<string | null>(null)
const editForm = reactive({
  username: '',
  password: '',
  role: 'user' as NsfwUserRole,
  active: true
})

async function loadUsers() {
  loading.value = true
  error.value = null
  try {
    users.value = await auth.listUsers()
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudieron cargar los usuarios'
  } finally {
    loading.value = false
  }
}

await auth.refresh()
if (!auth.isAdmin) {
  await navigateTo('/private')
}

await loadUsers()

async function onCreate() {
  message.value = null
  error.value = null
  try {
    await auth.createUser({ ...createForm })
    createForm.username = ''
    createForm.password = ''
    createForm.role = 'user'
    message.value = 'Usuario creado'
    await loadUsers()
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo crear el usuario'
  }
}

function startEdit(user: NsfwPublicUser) {
  editId.value = user.id
  editForm.username = user.username
  editForm.password = ''
  editForm.role = user.role
  editForm.active = user.active
}

function cancelEdit() {
  editId.value = null
}

async function onSaveEdit() {
  if (!editId.value) return
  message.value = null
  error.value = null
  try {
    await auth.updateUser(editId.value, {
      username: editForm.username,
      role: editForm.role,
      active: editForm.active,
      ...(editForm.password.trim() ? { password: editForm.password } : {})
    })
    message.value = 'Usuario actualizado'
    editId.value = null
    await loadUsers()
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo actualizar el usuario'
  }
}

function formatDate(value: number | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}
</script>

<template>
  <div class="nsfw-page mx-auto max-w-5xl px-4 py-8 sm:px-6">
    <header class="mb-6">
      <h1 class="font-serif text-3xl">Usuarios</h1>
      <p class="text-sm text-[var(--nsfw-muted)]">Crear, editar, resetear contraseña y activar/desactivar.</p>
    </header>

    <p v-if="message" class="mb-4 text-sm text-[var(--nsfw-success)]" aria-live="polite">{{ message }}</p>
    <p v-if="error" class="mb-4 text-sm text-[var(--nsfw-danger)]" aria-live="polite">{{ error }}</p>

    <section class="nsfw-card mb-8">
      <h2 class="mb-4 text-lg font-medium">Nuevo usuario</h2>
      <form class="grid gap-4 md:grid-cols-4" @submit.prevent="onCreate">
        <input
          v-model="createForm.username"
          class="nsfw-input"
          placeholder="Usuario"
          required
        >
        <input
          v-model="createForm.password"
          type="password"
          class="nsfw-input"
          placeholder="Contraseña"
          required
        >
        <select v-model="createForm.role" class="nsfw-input">
          <option value="user">Usuario</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit" class="nsfw-btn-primary">Crear</button>
      </form>
    </section>

    <section class="nsfw-card overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <thead class="text-[var(--nsfw-faint)]">
          <tr>
            <th class="px-2 py-2">Usuario</th>
            <th class="px-2 py-2">Rol</th>
            <th class="px-2 py-2">Estado</th>
            <th class="px-2 py-2">Último acceso</th>
            <th class="px-2 py-2">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="5" class="px-2 py-4 text-[var(--nsfw-muted)]">Cargando…</td>
          </tr>
          <tr v-for="user in users" :key="user.id" class="border-t border-[var(--nsfw-line)]">
            <td class="px-2 py-3">{{ user.username }}</td>
            <td class="px-2 py-3">{{ user.role }}</td>
            <td class="px-2 py-3">{{ user.active ? 'Activo' : 'Inactivo' }}</td>
            <td class="px-2 py-3">{{ formatDate(user.lastLoginAt) }}</td>
            <td class="px-2 py-3">
              <button type="button" class="nsfw-btn-ghost" @click="startEdit(user)">Editar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="editId" class="nsfw-card mt-8">
      <h2 class="mb-4 text-lg font-medium">Editar usuario</h2>
      <form class="grid gap-4 md:grid-cols-2" @submit.prevent="onSaveEdit">
        <input v-model="editForm.username" class="nsfw-input" required>
        <input
          v-model="editForm.password"
          type="password"
          class="nsfw-input"
          placeholder="Nueva contraseña (opcional)"
        >
        <select v-model="editForm.role" class="nsfw-input">
          <option value="user">Usuario</option>
          <option value="admin">Admin</option>
        </select>
        <label class="flex items-center gap-2 text-sm text-[var(--nsfw-muted)]">
          <input v-model="editForm.active" type="checkbox">
          Activo
        </label>
        <div class="flex gap-2 md:col-span-2">
          <button type="submit" class="nsfw-btn-primary">Guardar</button>
          <button type="button" class="nsfw-btn-ghost" @click="cancelEdit">Cancelar</button>
        </div>
      </form>
    </section>
  </div>
</template>
