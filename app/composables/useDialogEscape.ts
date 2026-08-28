interface DialogEscapeEntry {
  token: symbol
  close: () => void
  canClose: () => boolean
}

const dialogEscapeEntries: DialogEscapeEntry[] = []
let dialogEscapeConsumers = 0
let dialogEscapeListenerAttached = false

function handleDialogEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  const entry = dialogEscapeEntries[dialogEscapeEntries.length - 1]
  if (!entry || !entry.canClose()) return

  event.preventDefault()
  event.stopPropagation()
  dialogEscapeEntries.pop()
  entry.close()
}

export function useDialogEscape(
  isOpen: () => boolean,
  close: () => void,
  canClose: () => boolean = () => true
) {
  const token = Symbol('dialog')
  let stop: (() => void) | null = null

  function unregister() {
    const index = dialogEscapeEntries.findIndex((entry) => entry.token === token)
    if (index >= 0) dialogEscapeEntries.splice(index, 1)
  }

  function sync() {
    const registered = dialogEscapeEntries.some((entry) => entry.token === token)
    if (isOpen() && !registered) {
      dialogEscapeEntries.push({ token, close, canClose })
    } else if (!isOpen() && registered) {
      unregister()
    }
  }

  onMounted(() => {
    dialogEscapeConsumers += 1
    if (!dialogEscapeListenerAttached) {
      window.addEventListener('keydown', handleDialogEscape)
      dialogEscapeListenerAttached = true
    }
    sync()
    stop = watch(isOpen, sync)
  })

  onBeforeUnmount(() => {
    stop?.()
    unregister()
    dialogEscapeConsumers -= 1
    if (dialogEscapeConsumers === 0 && dialogEscapeListenerAttached) {
      window.removeEventListener('keydown', handleDialogEscape)
      dialogEscapeListenerAttached = false
    }
  })
}
