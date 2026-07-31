export default defineNuxtPlugin(async () => {
  await useSettingsStore().load()
})
