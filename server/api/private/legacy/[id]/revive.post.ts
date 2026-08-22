import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import { getStorage } from '../../../../utils/storage.ts'
import { createStorySession } from '../../../../utils/nsfwStorage.ts'
import { buildDefaultAssetPins } from '../../../../utils/nsfwStudio.ts'
import { listNarrativeModelCatalog } from '../../../../services/nsfw/modelCatalog.ts'

export default defineEventHandler((event) => {
  const user = requireSessionUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta id' })

  const story = getStorage().get('stories', 'private', id) as {
    id: string
    title?: string
    messages?: Array<{ role?: string; content?: string; text?: string }>
    characters?: Array<{ id?: string; name?: string }>
  } | null
  if (!story) throw createError({ statusCode: 404, statusMessage: 'Historia legado no encontrada' })

  const texts = (story.messages || [])
    .map((message) => (message.content || message.text || '').trim())
    .filter(Boolean)
  const premise =
    texts.slice(0, 3).join('\n\n').slice(0, 1200) ||
    'Reanudación desde historia privada legada (solo lectura).'

  const cast: Array<{
    actorId: string
    name: string
    role: 'protagonist' | 'character'
    personality: string
    isSelfInsert: boolean
    sourceCharacterId?: string | null
  }> = [
    {
      actorId: 'protagonist',
      name: 'Tú',
      role: 'protagonist',
      personality: '',
      isSelfInsert: true
    }
  ]
  const companion = story.characters?.find((item) => item.name)
  if (companion?.name) {
    cast.push({
      actorId: 'companion',
      name: companion.name,
      role: 'character',
      personality: '',
      isSelfInsert: false,
      sourceCharacterId: companion.id || null
    })
  } else {
    cast.push({
      actorId: 'companion',
      name: 'Compañero',
      role: 'character',
      personality: '',
      isSelfInsert: false
    })
  }

  const modelAlias = listNarrativeModelCatalog()[0]?.alias || 'G4-Dark-Soul-26B-A4B'
  const session = createStorySession(user.id, {
    title: `${story.title || 'Legado'} (nueva)`,
    premise,
    format: 'story',
    duration: 'medium',
    tone: 'sensual',
    perspective: 'second',
    interactionPolicy: 'pause',
    generationProfile: 'quick',
    modelAlias,
    interests: [],
    exclusions: [],
    planSummary: 'Continuar sin spoilers desde el legado privado.',
    cast,
    assetPins: buildDefaultAssetPins(user.id)
  })

  return { session }
})
