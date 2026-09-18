export function useMobileChrome() {
  const hidden = useState('mobile-chrome-hidden', () => false)
  const atTop = useState('mobile-chrome-at-top', () => true)

  function hide() {
    hidden.value = true
  }

  function show() {
    hidden.value = false
  }

  function toggle() {
    hidden.value = !hidden.value
  }

  function setAtTop(value: boolean) {
    atTop.value = value
  }

  return { hidden, atTop, hide, show, toggle, setAtTop }
}
