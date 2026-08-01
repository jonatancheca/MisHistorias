import { defineStore } from 'pinia'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
}

export const useConfirmStore = defineStore('confirm', () => {
  const dialog = ref<ConfirmOptions | null>(null)
  let resolveDialog: ((accepted: boolean) => void) | null = null
  let returnFocus: HTMLElement | null = null

  function ask(options: ConfirmOptions) {
    resolveDialog?.(false)
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.value = options
    return new Promise<boolean>((resolve) => {
      resolveDialog = resolve
    })
  }

  async function respond(accepted: boolean) {
    const resolve = resolveDialog
    resolveDialog = null
    dialog.value = null
    resolve?.(accepted)
    await nextTick()
    returnFocus?.focus()
    returnFocus = null
  }

  return { dialog, ask, respond }
})
