const MAX_SIDE = 1024
const QUALITY = 0.9

/** Redimensiona a máx. 1024px de lado y convierte a WebP para no inflar IndexedDB. */
export async function normalizeImage(file: File | Blob): Promise<{ blob: Blob; mimeType: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return { blob: file, mimeType: file.type || 'image/png' }
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', QUALITY)
  )
  if (!blob) return { blob: file, mimeType: file.type || 'image/png' }
  return { blob, mimeType: 'image/webp' }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  if (!/^data:image\//.test(dataUrl)) throw new Error('Data URL de imagen no válida')
  const response = await fetch(dataUrl)
  return response.blob()
}
