/**
 * Activa el ámbito visual privado y carga la serif estructural del rediseño.
 * Sin red, Newsreader cae a Georgia (mismo fallback que el documento de diseño).
 */
export function useNsfwScope() {
  useHead({
    link: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,200..600;1,6..72,200..500&display=swap'
      }
    ]
  })

  onMounted(() => {
    document.documentElement.classList.add('nsfw-scope')
  })

  onBeforeUnmount(() => {
    document.documentElement.classList.remove('nsfw-scope')
  })
}
