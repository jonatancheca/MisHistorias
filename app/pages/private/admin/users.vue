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
  return new Date(value).toLocaleString('es-ES')
}
</script>

<template>
  <div class="nsfw-page mx-auto max-w-[58rem] px-5 py-10 sm:px-12 sm:py-14">
    <header class="mb-9">
      <h1 class="font-serif text-4xl">Usuarios</h1>
      <p class="mt-1 text-xs text-[var(--nsfw-faint)]">
        Crear, editar, resetear contraseña y activar o desactivar.
      </p>
    </header>

    <p v-if="message" class="mb-4 text-sm text-[var(--nsfw-success)]" aria-live="polite">
      {{ message }}
    </p>
    <p v-if="error" class="mb-4 text-sm text-[var(--nsfw-danger)]" aria-live="polite">{{ error }}</p>

    <section class="mb-11">
      <div class="nsfw-section-head">
        <h3>Nuevo usuario</h3>
      </div>
      <form class="grid items-end gap-6 md:grid-cols-4" @submit.prevent="onCreate">
        <label class="block">
          <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Usuario</span>
          <input v-model="createForm.username" class="nsfw-underline" placeholder="Usuario" required>
        </label>
        <label class="block">
          <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Contraseña</span>
          <input
            v-model="createForm.password"
            type="password"
            class="nsfw-underline"
            placeholder="Contraseña"
            required
          >
        </label>
        <label class="block">
          <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Rol</span>
          <select v-model="createForm.role" class="nsfw-underline !text-base">
            <option value="user">Usuario</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button type="submit" class="nsfw-btn-primary">Crear</button>
      </form>
    </section>

    <section>
      <div class="nsfw-section-head">
        <h3>Cuentas</h3>
        <span class="text-xs text-[var(--nsfw-dim)]">{{ users.length }}</span>
      </div>

      <p v-if="loading" class="py-6 text-sm text-[var(--nsfw-muted)]">Cargando…</p>

      <div v-for="user in users" :key="user.id" class="nsfw-row cursor-default">
        <span class="min-w-0 flex-1">
          <span class="nsfw-row-title block truncate">{{ user.username }}</span>
          <span class="nsfw-row-sub block">
            {{ user.role === 'admin' ? 'Administrador' : 'Usuario' }} ·
            {{ user.active ? 'activo' : 'inactivo' }} · último acceso
            {{ formatDate(user.lastLoginAt) }}
          </span>
        </span>
        <button type="button" class="nsfw-btn-text shrink-0" @click="startEdit(user)">Editar</button>
      </div>
    </section>

    <section v-if="editId" class="mt-11">
      <div class="nsfw-section-head">
        <h3>Editar usuario</h3>
      </div>
      <form class="grid items-end gap-6 md:grid-cols-2" @submit.prevent="onSaveEdit">
        <label class="block">
          <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Usuario</span>
          <input v-model="editForm.username" class="nsfw-underline" required>
        </label>
        <label class="block">
          <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Nueva contraseña (opcional)</span>
          <input v-model="editForm.password" type="password" class="nsfw-underline">
        </label>
        <label class="block">
          <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Rol</span>
          <select v-model="editForm.role" class="nsfw-underline !text-base">
            <option value="user">Usuario</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label class="flex items-center gap-2.5 text-sm text-[var(--nsfw-muted)]">
          <input v-model="editForm.active" type="checkbox" class="accent-[var(--nsfw-accent)]">
          Activo
        </label>
        <div class="flex flex-wrap items-center gap-5 md:col-span-2">
          <button type="submit" class="nsfw-btn-primary">Guardar</button>
          <button type="button" class="nsfw-btn-text" @click="cancelEdit">Cancelar</button>
        </div>
      </form>
    </section>
  </div>
</template>
