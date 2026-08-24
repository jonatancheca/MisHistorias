import type { AppUpdateInfo } from '#shared/types'

interface CheckOptions {
  refresh?: boolean
  silent?: boolean
}

export function useAppUpdate() {
  const info = useState<AppUpdateInfo | null>('app-update-info', () => null)
  const pending = useState('app-update-pending', () => false)
  const checked = useState('app-update-checked', () => false)
  const error = useState<string | null>('app-update-error', () => null)

  async function check(options: CheckOptions = {}) {
    if (pending.value) return info.value

    pending.value = true
    if (!options.silent) error.value = null
    try {
      info.value = await $fetch<AppUpdateInfo>('/api/app-update', {
        query: options.refresh ? { refresh: '1' } : undefined
      })
      error.value = null
      checked.value = true
      return info.value
    } catch (caught) {
      checked.value = true
      const detail = caught as {
        data?: { message?: string; statusMessage?: string }
        statusMessage?: string
        message?: string
      }
      error.value = detail.data?.message || detail.data?.statusMessage || detail.statusMessage || detail.message ||
        'No se pudo comprobar la actualización.'
      return null
    } finally {
      pending.value = false
    }
  }

  return { info, pending, checked, error, check }
}
