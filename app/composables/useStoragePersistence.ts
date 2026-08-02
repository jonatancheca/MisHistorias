type StoragePersistenceNotice = {
  kind: 'warning' | 'success'
  message: string
}

interface PersistenceRequestOptions {
  checkExisting?: boolean
  announceSuccess?: boolean
}

export function useStoragePersistence() {
  const notice = useState<StoragePersistenceNotice | null>(
    'storage-persistence-notice',
    () => null
  )
  const requesting = useState('storage-persistence-requesting', () => false)

  async function requestPersistence(options: PersistenceRequestOptions = {}) {
    const { checkExisting = false, announceSuccess = true } = options
    const storage = navigator.storage

    if (!storage?.persist) {
      notice.value = {
        kind: 'warning',
        message:
          'Este navegador no permite proteger el almacenamiento local. Exporta una copia JSON desde Ajustes.'
      }
      return false
    }

    requesting.value = true
    try {
      const alreadyPersisted =
        checkExisting && storage.persisted ? await storage.persisted() : false
      const persisted = alreadyPersisted || (await storage.persist())

      if (persisted) {
        notice.value = announceSuccess
          ? {
              kind: 'success',
              message: 'Persistencia activada. El navegador protegerá los datos locales.'
            }
          : null
        return true
      }

      notice.value = {
        kind: 'warning',
        message:
          'El navegador no garantiza conservar los datos locales. Exporta una copia JSON desde Ajustes.'
      }
      return false
    } catch {
      notice.value = {
        kind: 'warning',
        message:
          'No se pudo proteger el almacenamiento local. Exporta una copia JSON desde Ajustes.'
      }
      return false
    } finally {
      requesting.value = false
    }
  }

  return { notice, requesting, requestPersistence }
}
