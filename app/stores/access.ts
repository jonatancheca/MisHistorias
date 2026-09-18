import type { AccessSession } from '#shared/types'
import { activateMultiUser, readAccessSession } from '~/lib/db'

const EMPTY_SESSION: AccessSession = {
  multiUserEnabled: false,
  identity: null,
  isAdmin: false,
  canActivate: false
}

export const useAccessStore = defineStore('access', () => {
  const session = ref<AccessSession>({ ...EMPTY_SESSION })
  const loaded = ref(false)
  const blocked = computed(() => session.value.multiUserEnabled && !session.value.identity)

  async function load(force = false) {
    if (loaded.value && !force) return session.value
    session.value = await readAccessSession()
    loaded.value = true
    return session.value
  }

  async function activate() {
    const email = session.value.identity?.email
    if (!email) throw new Error('No hay identidad de Cloudflare Access.')
    session.value = await activateMultiUser(email)
    loaded.value = true
    return session.value
  }

  return { session, loaded, blocked, load, activate }
})
