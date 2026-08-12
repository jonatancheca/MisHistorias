import type { Character, StoryImageCatalogEntry } from '#shared/types'
import type { StoredImage } from '~/lib/db'

export interface StoryImageCatalogChange {
  added: StoryImageCatalogEntry[]
  removed: StoryImageCatalogEntry[]
  updated: Array<{
    before: StoryImageCatalogEntry
    after: StoryImageCatalogEntry
    fields: Array<'tags' | 'description' | 'isDefault'>
  }>
}

export function buildStoryImageCatalog(
  characterIds: string[],
  characters: Character[],
  images: StoredImage[]
): StoryImageCatalogEntry[] {
  const selectedIds = new Set(characterIds)
  const names = new Map(characters.map((character) => [character.id, character.name]))

  return images
    .filter((image) => selectedIds.has(image.characterId))
    .map((image) => ({
      imageId: image.id,
      characterId: image.characterId,
      characterName: names.get(image.characterId) ?? 'Personaje no disponible',
      tags: [...image.tags],
      description: image.description,
      isDefault: image.isDefault
    }))
    .sort(
      (left, right) =>
        left.characterId.localeCompare(right.characterId) ||
        left.imageId.localeCompare(right.imageId)
    )
}

export function compareStoryImageCatalogs(
  previous: StoryImageCatalogEntry[],
  current: StoryImageCatalogEntry[]
): StoryImageCatalogChange | null {
  const previousById = new Map(previous.map((entry) => [entry.imageId, entry]))
  const currentById = new Map(current.map((entry) => [entry.imageId, entry]))
  const added = current.filter((entry) => !previousById.has(entry.imageId))
  const removed = previous.filter((entry) => !currentById.has(entry.imageId))
  const updated: StoryImageCatalogChange['updated'] = []

  for (const after of current) {
    const before = previousById.get(after.imageId)
    if (!before) continue
    const fields: StoryImageCatalogChange['updated'][number]['fields'] = []
    if (JSON.stringify(before.tags) !== JSON.stringify(after.tags)) fields.push('tags')
    if (before.description !== after.description) fields.push('description')
    if (before.isDefault !== after.isDefault) fields.push('isDefault')
    if (fields.length) updated.push({ before, after, fields })
  }

  if (!added.length && !removed.length && !updated.length) return null
  return { added, removed, updated }
}

function catalogLabel(entry: StoryImageCatalogEntry) {
  const tags = entry.tags.length ? entry.tags.map((tag) => `[${tag}]`).join('') : '[sin etiqueta]'
  return `${entry.characterName} ${tags}`
}

export function formatStoryImageCatalogChange(change: StoryImageCatalogChange) {
  const lines = [
    '## ACTUALIZACIÓN DEL CATÁLOGO DE IMÁGENES',
    'El catálogo de imágenes cambió desde la última respuesta válida.'
  ]

  for (const entry of change.added) {
    const details = entry.description || 'sin descripción'
    lines.push(
      `- Añadida: ${catalogLabel(entry)} — ${details}${entry.isDefault ? ' (predeterminada)' : ''}.`
    )
  }
  for (const entry of change.removed) {
    lines.push(`- Eliminada: ${catalogLabel(entry)}.`)
  }
  for (const entry of change.updated) {
    const fields = entry.fields.map((field) => {
      if (field === 'tags') return 'etiquetas'
      if (field === 'description') return 'descripción'
      return 'estado predeterminado'
    })
    lines.push(`- Actualizada: ${catalogLabel(entry.after)} (${fields.join(', ')}).`)
  }

  lines.push('Usa desde ahora el catálogo actualizado de la sección PERSONAJES.')
  return lines.join('\n')
}
