export function useMobileChrome() {
  const hidden = useState('mobile-chrome-hidden', () => false)

  function hide() {
    hidden.value = true
  }

  function show() {
    hidden.value = false
  }

  return { hidden, hide, show }
}
