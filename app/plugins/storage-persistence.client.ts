export default defineNuxtPlugin(async () => {
  await useStoragePersistence().requestPersistence({
    checkExisting: true,
    announceSuccess: false
  })
})
