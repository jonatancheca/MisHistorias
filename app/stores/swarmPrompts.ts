import { defineStore } from 'pinia'
import type { SwarmPrompt } from '#shared/types'
import { deleteSwarmPrompt, getActiveDataScope, listSwarmPrompts, newId, putSwarmPrompt } from '~/lib/db'
import { sanitizeTags } from '~/lib/tags'

export const useSwarmPromptsStore = defineStore('swarmPrompts', () => {
  const prompts = ref<SwarmPrompt[]>([])
  const loaded = ref(false)
  function resetForScope() {
    prompts.value = []
    loaded.value = false
  }

  async function load(force = false) {
    if (loaded.value && !force) return
    const scope = getActiveDataScope()
    const result = await listSwarmPrompts()
    if (scope !== getActiveDataScope()) return
    prompts.value = result
    loaded.value = true
  }
  async function save(input: { id?: string; name: string; prompt: string; tags: string[] }) {
    if (!input.name.trim() || !input.prompt.trim()) throw new Error('Nombre y prompt obligatorios.')
    const scope = getActiveDataScope()
    const existing = prompts.value.find((item) => item.id === input.id)
    const now = Date.now()
    const saved = await putSwarmPrompt({
      id: existing?.id ?? newId(), name: input.name.trim(), prompt: input.prompt.trim(),
      tags: sanitizeTags(input.tags), createdAt: existing?.createdAt ?? now, updatedAt: now
    })
    if (scope === getActiveDataScope()) await load(true)
    return saved
  }
  async function remove(id: string) {
    const scope = getActiveDataScope()
    await deleteSwarmPrompt(id)
    if (scope === getActiveDataScope()) prompts.value = prompts.value.filter((item) => item.id !== id)
  }
  return { prompts, loaded, load, save, remove, resetForScope }
})
