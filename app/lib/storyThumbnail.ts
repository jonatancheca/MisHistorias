export interface StoryThumbnailInput {
  backgroundUrl: string | null
  characterUrls: Array<string | null | undefined>
  title: string
  text: string
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('No se pudo cargar una imagen de la escena'))
    image.src = url
  })
}

function drawCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number
) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
  const drawnWidth = image.naturalWidth * scale
  const drawnHeight = image.naturalHeight * scale
  context.drawImage(image, (width - drawnWidth) / 2, (height - drawnHeight) / 2, drawnWidth, drawnHeight)
}

function shortened(value: string, maximum: number) {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= maximum ? compact : `${compact.slice(0, maximum - 1)}…`
}

export async function createStoryThumbnail(input: StoryThumbnailInput) {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 360
  const context = canvas.getContext('2d')
  if (!context) throw new Error('El navegador no permite crear la miniatura.')

  const background = input.backgroundUrl
    ? await loadImage(input.backgroundUrl).catch(() => null)
    : null
  if (background) {
    drawCover(context, background, canvas.width, canvas.height)
  } else {
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height)
    gradient.addColorStop(0, '#0f172a')
    gradient.addColorStop(1, '#312e81')
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)
  }

  const characterImages = (await Promise.all(
    input.characterUrls.filter((url): url is string => Boolean(url)).slice(-4).map((url) =>
      loadImage(url).catch(() => null)
    )
  )).filter((image): image is HTMLImageElement => Boolean(image))
  const slotWidth = canvas.width / Math.max(1, characterImages.length)
  characterImages.forEach((image, index) => {
    const maximumWidth = slotWidth * 1.15
    const maximumHeight = canvas.height * 0.9
    const scale = Math.min(maximumWidth / image.naturalWidth, maximumHeight / image.naturalHeight)
    const width = image.naturalWidth * scale
    const height = image.naturalHeight * scale
    const x = slotWidth * index + (slotWidth - width) / 2
    context.drawImage(image, x, canvas.height - height, width, height)
  })

  const shade = context.createLinearGradient(0, 220, 0, canvas.height)
  shade.addColorStop(0, 'rgba(2, 6, 23, 0)')
  shade.addColorStop(1, 'rgba(2, 6, 23, 0.92)')
  context.fillStyle = shade
  context.fillRect(0, 180, canvas.width, 180)
  context.fillStyle = '#ffffff'
  context.font = '700 22px system-ui, sans-serif'
  context.fillText(shortened(input.title, 48), 24, 307, canvas.width - 48)
  context.fillStyle = '#cbd5e1'
  context.font = '16px system-ui, sans-serif'
  context.fillText(shortened(input.text, 76), 24, 336, canvas.width - 48)

  const dataUrl = canvas.toDataURL('image/webp', 0.78)
  if (!dataUrl.startsWith('data:image/webp;base64,')) {
    throw new Error('El navegador no permite crear miniaturas WebP.')
  }
  return dataUrl
}
