export default defineNuxtPlugin(async () => {
  const warning = useState<string | null>('storage-persistence-warning', () => null)
  const storage = navigator.storage

  if (!storage?.persist) {
    warning.value =
      'Este navegador no permite proteger el almacenamiento local. Exporta una copia JSON desde Ajustes.'
    return
  }

  try {
    const alreadyPersisted = storage.persisted ? await storage.persisted() : false
    const persisted = alreadyPersisted || (await storage.persist())

    if (!persisted) {
      warning.value =
        'El navegador no garantiza conservar los datos locales. Exporta una copia JSON desde Ajustes.'
    }
  } catch {
    warning.value =
      'No se pudo proteger el almacenamiento local. Exporta una copia JSON desde Ajustes.'
  }
})
