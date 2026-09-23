<script setup lang="ts">
import type {
  AppSettings,
  DatabaseBackup,
  IdentityReassignmentPreview,
  IdentityReassignmentResource
} from '#shared/types'
import { fetchLlmModels, preloadLlmModel, unloadAllLlmModels } from '~/lib/llm'
import {
  getChromeLlmAvailability,
  prepareChromeLlm,
  type ChromeLlmAvailability
} from '~/lib/chromeLlm'
import {
  createDatabaseBackup,
  databaseBackupDownloadUrl,
  listDatabaseBackups,
  previewIdentityReassignment,
  reassignIdentity,
  restoreDatabaseBackup,
  updateAccessConfiguration,
  uploadDatabaseBackup
} from '~/lib/db'
import {
  fetchSwarmCatalog,
  fetchSwarmImage,
  type SwarmCatalog
} from '~/lib/swarm'
import { DEFAULT_CHARACTER_REFERENCE_PROMPT } from '~/lib/characterReferencePrompt'
import { DEFAULT_PRESET_CONTENT } from '~/lib/defaultPreset'

const settings = useSettingsStore()
const access = useAccessStore()
const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const stories = useStoriesStore()
const privacy = usePrivacyStore()
const confirmDialog = useConfirmStore()
const appUpdate = useAppUpdate()
const route = useRoute()
const router = useRouter()
await Promise.all([settings.load(), access.load()])

const canManageGlobal = computed(
  () => !access.session.multiUserEnabled || access.session.isAdmin
)
const activatingUsers = ref(false)
const updatingAccessConfiguration = ref(false)
const accessError = ref<string | null>(null)
const accessMessage = ref<string | null>(null)
const accessConfirmationEmail = ref(access.session.identity?.email ?? '')
const identityTransfer = reactive({
  sourceId: '',
  sourceEmail: '',
  destinationId: access.session.identity?.id ?? '',
  destinationEmail: access.session.identity?.email ?? ''
})
const identityTransferPreview = ref<IdentityReassignmentPreview | null>(null)
const identityTransferAction = ref<'preview' | 'reassign' | null>(null)
const identityTransferError = ref<string | null>(null)
const identityTransferMessage = ref<string | null>(null)
const identityResourceLabels: Record<IdentityReassignmentResource, string> = {
  characters: 'personajes',
  imageBlobs: 'archivos de imagen',
  images: 'imágenes de personajes',
  backgrounds: 'fondos',
  sounds: 'sonidos',
  stories: 'historias',
  messages: 'mensajes',
  llmDebugTraces: 'diagnósticos LLM',
  storySaves: 'partidas',
  presets: 'presets',
  swarmPrompts: 'prompts SwarmUI'
}
const canPreviewIdentityTransfer = computed(() =>
  identityTransfer.sourceId.trim() &&
  identityTransfer.sourceEmail.trim() &&
  identityTransfer.destinationId.trim() &&
  identityTransfer.destinationEmail.trim() &&
  !identityTransferAction.value
)

watch(identityTransfer, () => {
  identityTransferPreview.value = null
  identityTransferError.value = null
  identityTransferMessage.value = null
})

const settingsSections = [
  { id: 'apariencia', label: 'Apariencia' },
  { id: 'protagonista', label: 'Protagonista' },
  { id: 'usuarios', label: 'Usuarios' },
  { id: 'llm', label: 'LLM' },
  { id: 'prompt-narrativo', label: 'Prompt narrativo' },
  { id: 'swarmui', label: 'SwarmUI' },
  { id: 'actualizaciones', label: 'Actualizaciones' },
  { id: 'datos', label: 'Datos' }
] as const
type SettingsSectionId = typeof settingsSections[number]['id']
type SettingsDialogId = 'prompt-referencia-personaje' | 'prompts-swarmui'
interface SwarmPromptSettingsHandle {
  flushSave: () => Promise<boolean>
}

const settingsPageRef = ref<HTMLElement | null>(null)
const settingsNavRef = ref<HTMLElement | null>(null)
const activeSectionId = ref<SettingsSectionId>('apariencia')
const activeSettingsDialog = ref<SettingsDialogId | null>(null)
const settingsDialogBusy = ref(false)
const swarmPromptSettingsRef = ref<SwarmPromptSettingsHandle | null>(null)
const settingsNavDragging = ref(false)
let pageScrollContainer: HTMLElement | null = null
let sectionUpdateFrame: number | null = null
let navScrollFrame: number | null = null
let pendingHashBehavior: ScrollBehavior | null = null
let settingsNavDrag: {
  pointerId: number
  startX: number
  scrollLeft: number
  moved: boolean
} | null = null
let suppressSettingsNavClick = false
let settingsNavClickResetTimer: ReturnType<typeof setTimeout> | null = null

const SETTINGS_NAV_DRAG_THRESHOLD = 6

const form = reactive({ ...settings.settings })
const narrativePrompt = ref(settings.settings.narrativePrompt ?? DEFAULT_PRESET_CONTENT)
const narrativePromptCustomized = ref(settings.settings.narrativePrompt !== null)
const characterReferencePrompt = ref(
  settings.settings.characterReferencePrompt ?? DEFAULT_CHARACTER_REFERENCE_PROMPT
)
const characterReferencePromptCustomized = ref(
  settings.settings.characterReferencePrompt !== null
)
const privateLlmSettingsEnabled = ref(
  privacy.isPrivate && settings.settings.privateLlmSettingsEnabled
)
if (privacy.isPrivate) {
  if (privateLlmSettingsEnabled.value) {
    form.baseUrl = settings.settings.privateBaseUrl ?? settings.settings.baseUrl
    form.model = settings.settings.privateModel ?? settings.settings.model
    form.temperature = settings.settings.privateTemperature ?? settings.settings.temperature
    form.maxTokens = settings.settings.privateMaxTokens ?? settings.settings.maxTokens
    form.historyBudget = settings.settings.privateHistoryBudget ?? settings.settings.historyBudget
    form.apiKeyConfigured = settings.settings.privateApiKeyConfigured
  }
  form.userName = settings.settings.privateUserName ?? settings.settings.userName
  form.protagonistPreferences =
    settings.settings.privateProtagonistPreferences ?? settings.settings.protagonistPreferences
}
const models = ref<string[]>([])
const testing = ref(false)
const testMessage = ref<string | null>(null)
const testError = ref<string | null>(null)
const modelAction = ref<'load' | 'unload-all' | null>(null)
const modelActionMessage = ref<string | null>(null)
const modelActionError = ref<string | null>(null)
const configuredModelUnavailable = computed(() =>
  models.value.length > 0 && !!form.model.trim() && !models.value.includes(form.model.trim())
)
watch(() => form.baseUrl, () => {
  models.value = []
  testMessage.value = null
  testError.value = null
})
watch(() => form.model, () => {
  if (!configuredModelUnavailable.value &&
      testError.value === 'El modelo configurado no está disponible. Selecciona uno de la lista.') {
    testError.value = null
  }
})
const importing = ref(false)
const importMessage = ref<string | null>(null)
const importInput = ref<HTMLInputElement | null>(null)
const backupImportInput = ref<HTMLInputElement | null>(null)
const backups = ref<DatabaseBackup[]>([])
const backupsLoading = ref(false)
const backupAction = ref<string | null>(null)
const backupMessage = ref<string | null>(null)
const backupError = ref<string | null>(null)
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const saveError = ref<string | null>(null)
const swarmCatalog = ref<SwarmCatalog | null>(null)
const swarmTesting = ref(false)
const swarmTestMessage = ref<string | null>(null)
const swarmTestError = ref<string | null>(null)
const swarmTestPrompt = ref('A cinematic portrait of a traveler standing confidently, wearing a weathered coat, with a calm determined expression.')
const swarmTestPreset = ref('')
const swarmTestModel = ref('')
const swarmTestLora = ref('')
const swarmGenerating = ref(false)
const swarmPreviewUrl = ref<string | null>(null)
const chromeLlmEnabled = ref(settings.activeUseChromeLlm)
const chromeLlmAvailability = ref<ChromeLlmAvailability | 'checking' | 'error'>('checking')
const chromeLlmPreparing = ref(false)
const chromeLlmProgress = ref<number | null>(null)
const chromeLlmError = ref<string | null>(null)
let saveTimer: ReturnType<typeof setTimeout> | null = null
let savedTimer: ReturnType<typeof setTimeout> | null = null
let savePending = false
let saveRevision = 0
let saveQueue: Promise<void> = Promise.resolve()
let apiKeyDirty = false
let switchingPrivateLlmSettings = false
let swarmAuthTokenDirty = false
let privateUserNameDirty: boolean = false
let privateProtagonistPreferencesDirty: boolean = false
let narrativePromptDirty = false
let characterReferencePromptDirty = false
let privateClickCount = 0
let privateClickTimer: ReturnType<typeof setTimeout> | null = null
let demoClickCount = 0
let demoClickTimer: ReturnType<typeof setTimeout> | null = null

function sectionIdFromHash(hash: string): SettingsSectionId | null {
  const id = hash.startsWith('#') ? hash.slice(1) : hash
  return settingsSections.some(section => section.id === id)
    ? id as SettingsSectionId
    : null
}

function settingsDialogIdFromHash(hash: string): SettingsDialogId | null {
  const id = hash.startsWith('#') ? hash.slice(1) : hash
  return id === 'prompt-referencia-personaje' || id === 'prompts-swarmui' ? id : null
}

function sectionElement(id: SettingsSectionId) {
  return settingsPageRef.value?.querySelector<HTMLElement>(`#${id}`) ?? null
}

function settingsNavShell() {
  const shell = settingsNavRef.value?.closest<HTMLElement>('nav') ?? null
  return shell && shell.getBoundingClientRect().height > 0 ? shell : null
}

function revealActiveNavItem() {
  navScrollFrame = null
  const nav = settingsNavRef.value
  const link = nav?.querySelector<HTMLElement>(`[data-settings-section="${activeSectionId.value}"]`)
  if (!nav || !link) return

  const navRect = nav.getBoundingClientRect()
  const linkRect = link.getBoundingClientRect()
  let nextLeft = nav.scrollLeft
  if (linkRect.left < navRect.left) {
    nextLeft += linkRect.left - navRect.left - 8
  } else if (linkRect.right > navRect.right) {
    nextLeft += linkRect.right - navRect.right + 8
  } else {
    return
  }
  nav.scrollTo({ left: nextLeft, behavior: 'smooth' })
}

function setActiveSection(id: SettingsSectionId) {
  if (activeSectionId.value === id) return
  activeSectionId.value = id
  if (navScrollFrame !== null) cancelAnimationFrame(navScrollFrame)
  navScrollFrame = requestAnimationFrame(revealActiveNavItem)
}

function updateActiveSection() {
  sectionUpdateFrame = null
  const container = pageScrollContainer
  if (!container) return

  const lastSection = settingsSections.at(-1)
  if (lastSection && container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
    setActiveSection(lastSection.id)
    return
  }

  const activationLine = (settingsNavShell()?.getBoundingClientRect().bottom
    ?? container.getBoundingClientRect().top) + 24
  let current = settingsSections[0].id
  for (const section of settingsSections) {
    const element = sectionElement(section.id)
    if (!element || element.getBoundingClientRect().top > activationLine) break
    current = section.id
  }
  setActiveSection(current)
}

function queueSectionUpdate() {
  if (sectionUpdateFrame !== null) return
  sectionUpdateFrame = requestAnimationFrame(updateActiveSection)
}

function scrollToSettingsSection(id: SettingsSectionId, behavior: ScrollBehavior) {
  const container = pageScrollContainer
  const element = sectionElement(id)
  if (!container || !element) return

  const navHeight = settingsNavShell()?.getBoundingClientRect().height ?? 0
  const top = container.scrollTop
    + element.getBoundingClientRect().top
    - container.getBoundingClientRect().top
    - navHeight
    - 16
  container.scrollTo({ top: Math.max(0, top), behavior })
  setActiveSection(id)
}

function preferredScrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

function navigateToSettingsSection(id: SettingsSectionId) {
  const hash = `#${id}`
  const behavior = preferredScrollBehavior()
  if (route.hash === hash) {
    scrollToSettingsSection(id, behavior)
    return
  }

  pendingHashBehavior = behavior
  void router.push({ path: route.path, query: route.query, hash })
}

function openSettingsDialog(id: SettingsDialogId) {
  pendingHashBehavior = preferredScrollBehavior()
  void router.push({ path: route.path, query: route.query, hash: `#${id}` })
}

function startSettingsNavDrag(event: PointerEvent) {
  const nav = settingsNavRef.value
  if (
    event.pointerType !== 'mouse'
    || event.button !== 0
    || !nav
    || nav.scrollWidth <= nav.clientWidth
  ) return

  if (settingsNavClickResetTimer) clearTimeout(settingsNavClickResetTimer)
  settingsNavClickResetTimer = null
  suppressSettingsNavClick = false
  settingsNavDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    scrollLeft: nav.scrollLeft,
    moved: false
  }
}

function moveSettingsNavDrag(event: PointerEvent) {
  const nav = settingsNavRef.value
  if (!nav || !settingsNavDrag || settingsNavDrag.pointerId !== event.pointerId) return

  const deltaX = event.clientX - settingsNavDrag.startX
  if (!settingsNavDrag.moved && Math.abs(deltaX) < SETTINGS_NAV_DRAG_THRESHOLD) return

  if (!settingsNavDrag.moved) {
    settingsNavDrag.moved = true
    nav.setPointerCapture(event.pointerId)
  }
  settingsNavDragging.value = true
  event.preventDefault()
  nav.scrollLeft = settingsNavDrag.scrollLeft - deltaX
}

function endSettingsNavDrag(event: PointerEvent, suppressClick: boolean) {
  const nav = settingsNavRef.value
  if (!nav || !settingsNavDrag || settingsNavDrag.pointerId !== event.pointerId) return

  const moved = settingsNavDrag.moved
  settingsNavDrag = null
  settingsNavDragging.value = false
  if (nav.hasPointerCapture(event.pointerId)) nav.releasePointerCapture(event.pointerId)
  if (!moved || !suppressClick) return

  suppressSettingsNavClick = true
  settingsNavClickResetTimer = setTimeout(() => {
    suppressSettingsNavClick = false
    settingsNavClickResetTimer = null
  }, 0)
}

function onSettingsNavClick(event: MouseEvent, id: SettingsSectionId) {
  event.preventDefault()
  if (suppressSettingsNavClick) {
    suppressSettingsNavClick = false
    if (settingsNavClickResetTimer) clearTimeout(settingsNavClickResetTimer)
    settingsNavClickResetTimer = null
    return
  }
  navigateToSettingsSection(id)
}

watch(
  () => route.hash,
  async (hash) => {
    const nextDialog = settingsDialogIdFromHash(hash)
    const id = sectionIdFromHash(hash)
    const behavior = pendingHashBehavior ?? 'auto'
    pendingHashBehavior = null

    if (activeSettingsDialog.value && nextDialog !== activeSettingsDialog.value) {
      settingsDialogBusy.value = true
      const previousDialog = activeSettingsDialog.value
      const saved = await flushSettingsDialog(previousDialog)
      settingsDialogBusy.value = false
      if (!saved) {
        await router.replace({
          path: route.path,
          query: route.query,
          hash: `#${previousDialog}`
        })
        return
      }
      activeSettingsDialog.value = null
    }

    if (nextDialog) {
      activeSettingsDialog.value = nextDialog
      await nextTick()
      requestAnimationFrame(() => scrollToSettingsSection('swarmui', behavior))
      return
    }
    if (!id) return
    await nextTick()
    requestAnimationFrame(() => scrollToSettingsSection(id, behavior))
  }
)

async function testConnection() {
  testing.value = true
  testError.value = null
  testMessage.value = null
  try {
    await flushSave()
    const availableModels = await fetchLlmModels()
    models.value = availableModels
    testMessage.value = `${availableModels.length} modelos disponibles`
    if (!form.model && availableModels[0]) form.model = availableModels[0]
    if (configuredModelUnavailable.value) {
      testError.value = 'El modelo configurado no está disponible. Selecciona uno de la lista.'
    }
  } catch (caught) {
    const detail = caught as {
      data?: { message?: string; statusMessage?: string }
      statusMessage?: string
      message?: string
    }
    testError.value = detail.data?.message || detail.data?.statusMessage || detail.statusMessage ||
      detail.message || 'No se pudo conectar'
  } finally {
    testing.value = false
  }
}

async function preloadModel() {
  if (modelAction.value || !form.model.trim()) return
  modelAction.value = 'load'
  modelActionMessage.value = null
  modelActionError.value = null
  try {
    await flushSave()
    if (saveStatus.value === 'error') throw new Error('No se pudieron guardar los ajustes de LM Studio.')
    const result = await preloadLlmModel()
    modelActionMessage.value = result.status === 'already-loaded'
      ? 'El modelo configurado ya está cargado en LM Studio.'
      : 'Modelo cargado en LM Studio.'
  } catch (caught) {
    modelActionError.value = (caught as Error).message || 'No se pudo cargar el modelo.'
  } finally {
    modelAction.value = null
  }
}

async function unloadAllModels() {
  if (modelAction.value) return
  const accepted = await confirmDialog.ask({
    title: 'Descargar todos los modelos de memoria',
    message: 'Se descargarán todas las instancias cargadas en este servidor LM Studio, incluidas las de otras aplicaciones o usuarios. Las generaciones en curso pueden interrumpirse. Los archivos de los modelos no se borrarán.',
    confirmLabel: 'Descargar todos'
  })
  if (!accepted) return
  modelAction.value = 'unload-all'
  modelActionMessage.value = null
  modelActionError.value = null
  try {
    await flushSave()
    if (saveStatus.value === 'error') throw new Error('No se pudieron guardar los ajustes de LM Studio.')
    const result = await unloadAllLlmModels()
    modelActionMessage.value = result.total === 0
      ? 'No hay modelos cargados en LM Studio.'
      : `${result.unloaded} de ${result.total} instancias descargadas de memoria.`
    if (result.failed.length) {
      modelActionError.value = `Fallaron: ${result.failed.map(item => item.instanceId).join(', ')}.`
    }
  } catch (caught) {
    modelActionError.value = (caught as Error).message || 'No se pudieron descargar los modelos.'
  } finally {
    modelAction.value = null
  }
}

function settingsPatch() {
  const patch: Partial<AppSettings> = {
    responseSpeed: form.responseSpeed,
    userColor: form.userColor
  }
  if (privacy.isPrivate) {
    if (canManageGlobal.value && privateLlmSettingsEnabled.value) {
      patch.privateBaseUrl = form.baseUrl.trim()
      patch.privateModel = form.model
      patch.privateTemperature = Number(form.temperature)
      patch.privateMaxTokens = Number(form.maxTokens)
      patch.privateHistoryBudget = Number(form.historyBudget)
    }
    if (privateUserNameDirty) patch.privateUserName = form.userName.trim() || 'Protagonista'
    if (privateProtagonistPreferencesDirty) {
      patch.privateProtagonistPreferences = form.protagonistPreferences.trim()
    }
  } else {
    if (canManageGlobal.value) {
      patch.baseUrl = form.baseUrl.trim()
      patch.model = form.model
      patch.temperature = Number(form.temperature)
      patch.maxTokens = Number(form.maxTokens)
      patch.historyBudget = Number(form.historyBudget)
    }
    patch.userName = form.userName.trim() || 'Protagonista'
    patch.protagonistPreferences = form.protagonistPreferences.trim()
  }
  if (canManageGlobal.value) patch.swarmBaseUrl = form.swarmBaseUrl.trim()
  if (canManageGlobal.value && narrativePromptDirty) {
    patch.narrativePrompt = narrativePromptCustomized.value ? narrativePrompt.value : null
  }
  if (canManageGlobal.value && characterReferencePromptDirty) {
    patch.characterReferencePrompt = characterReferencePromptCustomized.value
      ? characterReferencePrompt.value
      : null
  }
  if (canManageGlobal.value && apiKeyDirty) {
    if (privacy.isPrivate && privateLlmSettingsEnabled.value) {
      patch.privateApiKey = form.apiKey.trim()
    } else if (!privacy.isPrivate) {
      patch.apiKey = form.apiKey.trim()
    }
  }
  if (canManageGlobal.value && swarmAuthTokenDirty) {
    patch.swarmAuthToken = form.swarmAuthToken.trim()
  }
  return patch
}

async function activateUsers() {
  const email = accessConfirmationEmail.value.trim()
  const configuration = {
    teamDomain: form.accessTeamDomain.trim(),
    audience: form.accessAudience.trim()
  }
  if (!email || !configuration.teamDomain || !configuration.audience ||
      activatingUsers.value || access.session.multiUserEnabled) return
  const accepted = await confirmDialog.ask({
    title: 'Activar configuración por usuarios',
    message: `Se asignarán todos los datos actuales a ${email}, que será el administrador de la instancia. La activación no se puede deshacer desde la interfaz.`,
    confirmLabel: 'Activar'
  })
  if (!accepted) return
  activatingUsers.value = true
  accessError.value = null
  accessMessage.value = null
  try {
    await flushSave()
    await access.activate(email, configuration)
    window.location.reload()
  } catch (caught) {
    accessError.value = (caught as Error).message || 'No se pudo activar la configuración por usuarios.'
    activatingUsers.value = false
  }
}

async function saveAccessConfiguration() {
  if (!access.session.isAdmin || updatingAccessConfiguration.value) return
  updatingAccessConfiguration.value = true
  accessError.value = null
  accessMessage.value = null
  try {
    const saved = await updateAccessConfiguration({
      teamDomain: form.accessTeamDomain.trim(),
      audience: form.accessAudience.trim()
    })
    form.accessTeamDomain = saved.teamDomain
    form.accessAudience = saved.audience
    accessMessage.value = 'Configuración de Cloudflare Access actualizada.'
  } catch (caught) {
    accessError.value = apiErrorMessage(caught, 'No se pudo actualizar Cloudflare Access.')
  } finally {
    updatingAccessConfiguration.value = false
  }
}

function identityTransferRequest() {
  return {
    source: {
      id: identityTransfer.sourceId.trim(),
      email: identityTransfer.sourceEmail.trim()
    },
    destination: {
      id: identityTransfer.destinationId.trim(),
      email: identityTransfer.destinationEmail.trim()
    }
  }
}

function affectedIdentityEntries(
  scope: IdentityReassignmentPreview['affected']['normal']
) {
  return (Object.entries(scope) as Array<[IdentityReassignmentResource, number]>)
    .filter(([, count]) => count > 0)
    .map(([resource, count]) => ({ resource, count, label: identityResourceLabels[resource] }))
}

async function previewIdentityTransfer() {
  if (!canPreviewIdentityTransfer.value) return
  identityTransferAction.value = 'preview'
  identityTransferError.value = null
  identityTransferMessage.value = null
  try {
    const preview = await previewIdentityReassignment(identityTransferRequest())
    identityTransfer.sourceId = preview.source.id
    identityTransfer.sourceEmail = preview.source.email
    identityTransfer.destinationId = preview.destination.id
    identityTransfer.destinationEmail = preview.destination.email
    await nextTick()
    identityTransferPreview.value = preview
  } catch (caught) {
    identityTransferError.value = backupErrorMessage(
      caught,
      'No se pudo previsualizar la reasignación.'
    )
  } finally {
    identityTransferAction.value = null
  }
}

async function confirmIdentityTransfer() {
  const preview = identityTransferPreview.value
  if (!preview || identityTransferAction.value) return
  const accepted = await confirmDialog.ask({
    title: 'Reasignar identidad Access',
    message: `Se moverán ${preview.affected.total} registros de ${preview.source.email} (${preview.source.id}) a ${preview.destination.email} (${preview.destination.id}).${preview.movesAdministrator ? ' También se transferirá la administración de la instancia.' : ''} La operación es transaccional y quedará auditada.`,
    confirmLabel: 'Reasignar'
  })
  if (!accepted) return

  identityTransferAction.value = 'reassign'
  identityTransferError.value = null
  identityTransferMessage.value = null
  try {
    const result = await reassignIdentity(preview)
    await access.load(true)
    identityTransferPreview.value = null
    identityTransferMessage.value = `Reasignación completada. Auditoría: ${result.auditId}`
  } catch (caught) {
    identityTransferPreview.value = null
    identityTransferError.value = backupErrorMessage(
      caught,
      'No se pudo completar la reasignación.'
    )
  } finally {
    identityTransferAction.value = null
  }
}

function enqueueSave(revision: number) {
  const patch = settingsPatch()
  const run = async () => {
    if (savedTimer) {
      clearTimeout(savedTimer)
      savedTimer = null
    }
    saveStatus.value = 'saving'
    saveError.value = null
    try {
      await settings.save(patch)
      if (revision === saveRevision) {
        if ('apiKey' in patch || 'privateApiKey' in patch) {
          apiKeyDirty = false
          form.apiKey = ''
        }
        if ('swarmAuthToken' in patch) {
          swarmAuthTokenDirty = false
          form.swarmAuthToken = ''
        }
        if ('privateUserName' in patch) privateUserNameDirty = false
        if ('privateProtagonistPreferences' in patch) privateProtagonistPreferencesDirty = false
        if ('narrativePrompt' in patch) narrativePromptDirty = false
        if ('characterReferencePrompt' in patch) characterReferencePromptDirty = false
        form.apiKeyConfigured =
          privacy.isPrivate && privateLlmSettingsEnabled.value
            ? settings.settings.privateApiKeyConfigured
            : settings.settings.apiKeyConfigured
        form.swarmAuthConfigured = settings.settings.swarmAuthConfigured
        saveStatus.value = 'saved'
        savedTimer = setTimeout(() => {
          savedTimer = null
          if (saveStatus.value === 'saved') saveStatus.value = 'idle'
        }, 2000)
      }
    } catch (caught) {
      if (revision === saveRevision) {
        saveStatus.value = 'error'
        saveError.value = (caught as Error).message || 'No se pudieron guardar los ajustes.'
      }
    }
  }
  saveQueue = saveQueue.then(run, run)
  return saveQueue
}

function onApiKeyInput() {
  apiKeyDirty = true
}

function onSwarmAuthTokenInput() {
  swarmAuthTokenDirty = true
}

function markPrivateUserNameDirty() {
  privateUserNameDirty = true
}

function markPrivateProtagonistPreferencesDirty() {
  privateProtagonistPreferencesDirty = true
}

function onNarrativePromptInput() {
  narrativePromptCustomized.value = true
  narrativePromptDirty = true
  scheduleSave()
}

function revertNarrativePrompt() {
  narrativePrompt.value = DEFAULT_PRESET_CONTENT
  narrativePromptCustomized.value = false
  narrativePromptDirty = true
  scheduleSave()
}

function onCharacterReferencePromptInput() {
  characterReferencePromptCustomized.value = true
  characterReferencePromptDirty = true
  scheduleSave()
}

function revertCharacterReferencePrompt() {
  characterReferencePrompt.value = DEFAULT_CHARACTER_REFERENCE_PROMPT
  characterReferencePromptCustomized.value = false
  characterReferencePromptDirty = true
  scheduleSave()
}

function clearApiKey() {
  form.apiKey = ''
  apiKeyDirty = true
  scheduleSave()
}

async function setPrivateLlmSettingsEnabled(enabled: boolean) {
  if (!privacy.isPrivate || switchingPrivateLlmSettings) return
  switchingPrivateLlmSettings = true
  try {
    await flushSave()
    privateLlmSettingsEnabled.value = enabled
    form.baseUrl = settings.settings.baseUrl
    form.model = settings.settings.model
    form.temperature = settings.settings.temperature
    form.maxTokens = settings.settings.maxTokens
    form.historyBudget = settings.settings.historyBudget
    form.apiKey = ''
    apiKeyDirty = false
    if (enabled) {
      await settings.save({
        privateLlmSettingsEnabled: true,
        privateBaseUrl: form.baseUrl,
        privateModel: form.model,
        privateTemperature: form.temperature,
        privateMaxTokens: form.maxTokens,
        privateHistoryBudget: form.historyBudget
      })
      form.apiKeyConfigured = settings.settings.privateApiKeyConfigured
    } else {
      await settings.save({
        privateLlmSettingsEnabled: false,
        privateBaseUrl: null,
        privateApiKey: '',
        privateModel: null,
        privateTemperature: null,
        privateMaxTokens: null,
        privateHistoryBudget: null
      })
      form.apiKeyConfigured = settings.settings.apiKeyConfigured
    }
    saveStatus.value = 'saved'
    await nextTick()
  } catch (caught) {
    privateLlmSettingsEnabled.value = settings.settings.privateLlmSettingsEnabled
    saveStatus.value = 'error'
    saveError.value = (caught as Error).message || 'No se pudieron guardar los ajustes privados.'
  } finally {
    switchingPrivateLlmSettings = false
  }
}

function clearSwarmAuthToken() {
  form.swarmAuthToken = ''
  swarmAuthTokenDirty = true
  scheduleSave()
}

function scheduleSave() {
  if (switchingPrivateLlmSettings) return
  saveRevision += 1
  savePending = true
  if (saveTimer) clearTimeout(saveTimer)
  const revision = saveRevision
  saveTimer = setTimeout(() => {
    saveTimer = null
    savePending = false
    void enqueueSave(revision)
  }, 500)
}

async function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (savePending) {
    savePending = false
    await enqueueSave(saveRevision)
  } else {
    await saveQueue
  }
}

async function flushSettingsDialog(id: SettingsDialogId) {
  if (id === 'prompts-swarmui') {
    return await swarmPromptSettingsRef.value?.flushSave() ?? true
  }
  await flushSave()
  return saveStatus.value !== 'error'
}

async function closeSettingsDialog() {
  const id = activeSettingsDialog.value
  if (!id || settingsDialogBusy.value) return

  settingsDialogBusy.value = true
  const saved = await flushSettingsDialog(id)
  if (!saved) {
    settingsDialogBusy.value = false
    return
  }

  activeSettingsDialog.value = null
  await router.replace({ path: route.path, query: route.query, hash: '#swarmui' })
  settingsDialogBusy.value = false
}

watch(
  () => [
    form.baseUrl,
    form.apiKey,
    form.swarmBaseUrl,
    form.swarmAuthToken,
    form.model,
    form.temperature,
    form.maxTokens,
    form.historyBudget,
    form.responseSpeed,
    form.userName,
    form.userColor,
    form.protagonistPreferences
  ],
  scheduleSave
)

async function testSwarmConnection() {
  swarmTesting.value = true
  swarmTestMessage.value = null
  swarmTestError.value = null
  try {
    await flushSave()
    const catalog = await fetchSwarmCatalog()
    swarmCatalog.value = catalog
    if (!swarmTestPreset.value && catalog.presets[0]) {
      swarmTestPreset.value = catalog.presets[0]
    }
    if (!swarmTestModel.value && catalog.models[0]) {
      swarmTestModel.value = catalog.models[0]
    }
    swarmTestMessage.value = `SwarmUI ${catalog.version || 'conectado'}: ${catalog.models.length} modelos, ${catalog.loras.length} LoRAs y ${catalog.presets.length} presets.`
  } catch (caught) {
    swarmTestError.value = (caught as Error).message || 'No se pudo conectar con SwarmUI.'
  } finally {
    swarmTesting.value = false
  }
}

async function generateSwarmPreview() {
  if (!swarmTestPrompt.value.trim() || swarmGenerating.value) return
  swarmGenerating.value = true
  swarmTestError.value = null
  try {
    if (!swarmCatalog.value) await testSwarmConnection()
    const preset = swarmTestPreset.value.trim()
    const model = swarmTestModel.value.trim()
    const lora = swarmTestLora.value.trim()
    if (!preset && !model) throw new Error('SwarmUI no ofrece presets ni modelos.')
    const blob = await fetchSwarmImage({
      prompt: swarmTestPrompt.value,
      ...(preset ? { preset } : {}),
      ...(model ? { model } : {}),
      ...(lora ? { lora } : {})
    })
    if (swarmPreviewUrl.value) URL.revokeObjectURL(swarmPreviewUrl.value)
    swarmPreviewUrl.value = URL.createObjectURL(blob)
  } catch (caught) {
    swarmTestError.value = (caught as Error).message || 'No se pudo generar la imagen.'
  } finally {
    swarmGenerating.value = false
  }
}

async function setTheme(theme: 'system' | 'light' | 'dark') {
  form.theme = theme
  await settings.save({ theme })
}

async function setMockMode(mockMode: boolean) {
  form.mockMode = mockMode
  await settings.save({ mockMode })
}

async function doExport() {
  const { exportBundle, downloadBundle } = await import('~/lib/transfer')
  downloadBundle(await exportBundle({ demo: privacy.isDemo }))
}

async function refreshChromeLlmAvailability() {
  chromeLlmAvailability.value = 'checking'
  chromeLlmError.value = null
  try {
    chromeLlmAvailability.value = await getChromeLlmAvailability()
  } catch (caught) {
    chromeLlmAvailability.value = 'error'
    chromeLlmError.value = (caught as Error).message || 'No se pudo comprobar la IA local de Chrome.'
  }
}

async function setChromeLlmEnabled(enabled: boolean) {
  if (chromeLlmPreparing.value) return
  chromeLlmError.value = null
  chromeLlmEnabled.value = enabled

  const patch = privacy.isPrivate
    ? { privateUseChromeLlm: enabled }
    : { useChromeLlm: enabled }

  if (!enabled) {
    try {
      await settings.save(patch)
      chromeLlmEnabled.value = false
    } catch (caught) {
      chromeLlmEnabled.value = settings.activeUseChromeLlm
      chromeLlmError.value = (caught as Error).message || 'No se pudo guardar el ajuste.'
    }
    return
  }

  chromeLlmPreparing.value = true
  chromeLlmProgress.value = null
  try {
    const availability = await getChromeLlmAvailability()
    chromeLlmAvailability.value = availability
    if (availability === 'unavailable') {
      throw new Error('La IA local de Chrome no está disponible en este navegador o equipo.')
    }
    await prepareChromeLlm({
      onDownloadProgress(percent) {
        chromeLlmProgress.value = percent
        chromeLlmAvailability.value = percent >= 100 ? 'available' : 'downloading'
      }
    })
    await settings.save(patch)
    chromeLlmEnabled.value = true
    chromeLlmAvailability.value = 'available'
  } catch (caught) {
    chromeLlmEnabled.value = settings.activeUseChromeLlm
    chromeLlmError.value = (caught as Error).message || 'No se pudo preparar la IA local de Chrome.'
  } finally {
    chromeLlmPreparing.value = false
  }
}

function backupErrorMessage(caught: unknown, fallback: string) {
  const detail = caught as {
    data?: { message?: string; statusMessage?: string }
    statusMessage?: string
    message?: string
  }
  return detail.data?.message || detail.data?.statusMessage || detail.statusMessage ||
    detail.message || fallback
}

async function loadBackups() {
  backupsLoading.value = true
  backupError.value = null
  try {
    backups.value = await listDatabaseBackups()
  } catch (caught) {
    backupError.value = backupErrorMessage(caught, 'No se pudieron cargar los backups.')
  } finally {
    backupsLoading.value = false
  }
}

async function createBackup() {
  backupAction.value = 'create'
  backupMessage.value = null
  backupError.value = null
  try {
    await flushSave()
    const created = await createDatabaseBackup()
    await loadBackups()
    backupMessage.value = `Backup creado: ${created.name}`
  } catch (caught) {
    backupError.value = backupErrorMessage(caught, 'No se pudo crear el backup.')
  } finally {
    backupAction.value = null
  }
}

async function uploadBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  backupAction.value = 'upload'
  backupMessage.value = null
  backupError.value = null
  try {
    const uploaded = await uploadDatabaseBackup(file)
    await loadBackups()
    backupMessage.value = `Backup subido: ${uploaded.name}`
  } catch (caught) {
    backupError.value = backupErrorMessage(caught, 'No se pudo subir el backup.')
  } finally {
    backupAction.value = null
    input.value = ''
  }
}

async function restoreBackup(backup: DatabaseBackup) {
  const accepted = await confirmDialog.ask({
    title: 'Restaurar backup',
    message: `Restaurar “${backup.name}” reemplazará toda la base SQLite actual: colección normal, colección privada y ajustes. Antes se creará otro backup de seguridad.`,
    confirmLabel: 'Restaurar'
  })
  if (!accepted) return

  backupAction.value = `restore:${backup.name}`
  backupMessage.value = null
  backupError.value = null
  try {
    await flushSave()
    await restoreDatabaseBackup(backup.name)
    sessionStorage.setItem('mishistorias-backup-message', `Backup restaurado: ${backup.name}`)
    window.location.reload()
  } catch (caught) {
    backupError.value = backupErrorMessage(caught, 'No se pudo restaurar el backup.')
    backupAction.value = null
  }
}

function backupKindLabel(kind: DatabaseBackup['kind']) {
  if (kind === 'manual') return 'Manual'
  if (kind === 'uploaded') return 'Subido'
  if (kind === 'before-restore') return 'Antes de restaurar'
  return 'Antes de migrar'
}

function formatBackupDate(value: string) {
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function formatReleaseDate(value: string | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function refreshAppUpdate() {
  return appUpdate.check({ refresh: true })
}

function formatBackupSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

if (canManageGlobal.value) await loadBackups()

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importing.value = true
  importMessage.value = null
  try {
    const { importBundle } = await import('~/lib/transfer')
    await importBundle(await file.text())
    await Promise.all([
      characters.load(true),
      backgrounds.load(true),
      stories.load(true),
      useSoundsStore().load(true),
      useSwarmPromptsStore().load(true)
    ])
    importMessage.value = 'Importación completada'
  } catch (caught) {
    importMessage.value = (caught as Error).message || 'Fallo al importar'
  } finally {
    importing.value = false
    input.value = ''
  }
}

async function onPrivateTrigger() {
  if (privacy.isPrivateMode) return

  privateClickCount += 1
  if (privateClickTimer) clearTimeout(privateClickTimer)

  if (privateClickCount === 3) {
    privateClickCount = 0
    privateClickTimer = null
    await privacy.activate()
    return
  }

  privateClickTimer = setTimeout(() => {
    privateClickCount = 0
    privateClickTimer = null
  }, 1000)
}

async function onDemoTrigger() {
  demoClickCount += 1
  if (demoClickTimer) clearTimeout(demoClickTimer)

  if (demoClickCount === 3) {
    demoClickCount = 0
    demoClickTimer = null
    await privacy.toggleDemo()
    return
  }

  demoClickTimer = setTimeout(() => {
    demoClickCount = 0
    demoClickTimer = null
  }, 1000)
}

onBeforeUnmount(() => {
  if (privateClickTimer) clearTimeout(privateClickTimer)
  if (demoClickTimer) clearTimeout(demoClickTimer)
  if (savedTimer) clearTimeout(savedTimer)
  if (swarmPreviewUrl.value) URL.revokeObjectURL(swarmPreviewUrl.value)
  if (sectionUpdateFrame !== null) cancelAnimationFrame(sectionUpdateFrame)
  if (navScrollFrame !== null) cancelAnimationFrame(navScrollFrame)
  if (settingsNavClickResetTimer) clearTimeout(settingsNavClickResetTimer)
  pageScrollContainer?.removeEventListener('scroll', queueSectionUpdate)
  window.removeEventListener('resize', queueSectionUpdate)
  void flushSave()
})

onMounted(() => {
  pageScrollContainer = settingsPageRef.value?.closest('main') ?? null
  pageScrollContainer?.addEventListener('scroll', queueSectionUpdate, { passive: true })
  window.addEventListener('resize', queueSectionUpdate)
  requestAnimationFrame(() => {
    const initialDialog = settingsDialogIdFromHash(route.hash)
    const initialSection = sectionIdFromHash(route.hash)
    if (initialDialog) {
      activeSettingsDialog.value = initialDialog
      scrollToSettingsSection('swarmui', 'auto')
    } else if (initialSection) scrollToSettingsSection(initialSection, 'auto')
    else updateActiveSection()
  })
  void refreshChromeLlmAvailability()
  if (!appUpdate.checked.value) void appUpdate.check({ silent: true })
  const message = sessionStorage.getItem('mishistorias-backup-message')
  if (!message) return
  sessionStorage.removeItem('mishistorias-backup-message')
  backupMessage.value = message
})

onBeforeRouteLeave(async () => {
  await flushSave()
  if (saveStatus.value === 'error') return false
  if (
    activeSettingsDialog.value === 'prompts-swarmui'
    && !await flushSettingsDialog('prompts-swarmui')
  ) return false
})
</script>

<template>
  <div ref="settingsPageRef" class="settings-page page-shell">
    <header class="mb-7">
      <p class="page-kicker">Tu espacio</p>
      <h1 class="page-title">Ajustes</h1>
      <p class="mt-2 min-h-5 text-xs text-[var(--color-fg-muted)]" aria-live="polite">
        <span v-if="saveStatus === 'saving'">Guardando…</span>
        <span v-else-if="saveStatus === 'saved'">Guardado</span>
        <span v-else-if="saveStatus === 'error'" class="text-red-500">
          {{ saveError || 'Error al guardar' }}
        </span>
        <span v-else>Personaliza la experiencia y las conexiones de la aplicación.</span>
      </p>
      <p
        v-if="access.session.multiUserEnabled && !access.session.isAdmin"
        class="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300"
      >
        Los ajustes técnicos y los backups los gestiona el administrador de la instancia.
      </p>
    </header>

    <nav
      class="settings-nav-shell sticky top-0 z-20 mb-5 hidden py-3 sm:block"
      aria-label="Secciones de ajustes"
    >
      <div
        ref="settingsNavRef"
        class="settings-section-nav flex gap-1.5 overflow-x-auto rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface-elevated)] p-2"
        :class="{ 'settings-section-nav-dragging': settingsNavDragging }"
        data-testid="settings-section-nav"
        @pointerdown="startSettingsNavDrag"
        @pointermove="moveSettingsNavDrag"
        @pointerup="endSettingsNavDrag($event, true)"
        @pointercancel="endSettingsNavDrag($event, false)"
      >
        <a
          v-for="(section, index) in settingsSections"
          :key="section.id"
          :href="`#${section.id}`"
          class="settings-nav-link shrink-0 rounded-xl px-3 py-2 text-sm font-semibold"
          :class="activeSectionId === section.id
            ? 'settings-nav-link-active'
            : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'"
          :aria-current="activeSectionId === section.id ? 'location' : undefined"
          :data-settings-section="section.id"
          :draggable="false"
          @click="onSettingsNavClick($event, section.id)"
        >
          <span class="settings-nav-index">{{ String(index + 1).padStart(2, '0') }}</span>
          {{ section.label }}
        </a>
      </div>
    </nav>

    <section
      id="apariencia"
      class="settings-panel"
      :class="{ 'settings-panel-active': activeSectionId === 'apariencia' }"
    >
      <h2>Apariencia</h2>
      <p>Elige cómo se adapta la interfaz a tu entorno.</p>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          :class="settings.settings.theme === 'system' ? 'btn-primary' : 'btn-ghost'"
          @click="setTheme('system')"
        >
          <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="13" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
          Sistema
        </button>
        <button
          type="button"
          :class="settings.settings.theme === 'light' ? 'btn-primary' : 'btn-ghost'"
          @click="setTheme('light')"
        >
          <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
          </svg>
          Modo claro
        </button>
        <button
          type="button"
          :class="settings.settings.theme === 'dark' ? 'btn-primary' : 'btn-ghost'"
          @click="setTheme('dark')"
        >
          <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
          </svg>
          Modo oscuro
        </button>
        <button
          type="button"
          class="h-10 w-12 opacity-0"
          aria-label="Activar modo privado"
          :disabled="privacy.switching || privacy.isPrivateMode"
          @click="onPrivateTrigger"
        />
      </div>
      <div class="mt-5 max-w-sm">
        <label class="label" for="responseSpeed">Velocidad de escritura</label>
        <select id="responseSpeed" v-model="form.responseSpeed" class="field">
          <option value="slow">Lenta</option>
          <option value="medium">Media</option>
          <option value="high">Alta</option>
          <option value="instant">Inmediata</option>
        </select>
        <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
          Preferencia personal para mostrar las respuestas recibidas.
        </p>
      </div>
    </section>

    <section
      id="protagonista"
      class="settings-panel"
      :class="{ 'settings-panel-active': activeSectionId === 'protagonista' }"
    >
      <h2>Protagonista</h2>
      <p>
        <template v-if="privacy.isPrivate">
          Nombre y preferencias exclusivos del modo privado. El color sigue compartido.
        </template>
        <template v-else>Nombre, color y preferencias con los que apareces en todas las historias.</template>
      </p>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="userName">{{ privacy.isPrivate ? 'Nombre privado' : 'Nombre' }}</label>
          <input
            id="userName"
            v-model="form.userName"
            autocomplete="off"
            class="field"
            placeholder="Protagonista"
            @input="markPrivateUserNameDirty"
          >
        </div>
        <div>
          <label class="label" for="userColor">Color</label>
          <div class="flex items-center gap-3">
            <input
            id="userColor"
            v-model="form.userColor"
            type="color"
            autocomplete="off"
            class="h-9 w-14 cursor-pointer rounded border border-[var(--color-border-soft)] bg-transparent"
            >
            <span class="text-sm font-semibold" :style="{ color: form.userColor }">
              {{ form.userName || 'Protagonista' }}
            </span>
          </div>
        </div>
        <div class="sm:col-span-2">
          <label class="label" for="protagonistPreferences">
            {{ privacy.isPrivate ? 'Preferencias globales privadas' : 'Preferencias globales' }}
          </label>
          <textarea
            id="protagonistPreferences"
            v-model="form.protagonistPreferences"
            autocomplete="off"
            class="field min-h-28"
            placeholder="Personalidad, límites, objetivos o forma de actuar del protagonista."
            @input="markPrivateProtagonistPreferencesDirty"
          />
        </div>
      </div>
    </section>

    <section
      id="usuarios"
      class="settings-panel"
      :class="{ 'settings-panel-active': activeSectionId === 'usuarios' }"
      data-testid="access-user-settings"
    >
      <h2>Usuarios</h2>
      <p>
        Aísla historias, personajes y recursos por una identidad de Cloudflare Access validada criptográficamente.
      </p>
      <div
        v-if="!access.session.multiUserEnabled || access.session.isAdmin"
        class="mb-4 grid min-w-0 gap-4 sm:grid-cols-2"
      >
        <label class="grid min-w-0 gap-1 text-xs font-semibold">
          Dominio del equipo
          <input
            v-model="form.accessTeamDomain"
            class="field min-w-0"
            type="url"
            autocomplete="off"
            spellcheck="false"
            placeholder="https://equipo.cloudflareaccess.com"
          >
        </label>
        <label class="grid min-w-0 gap-1 text-xs font-semibold">
          Audience de la aplicación
          <input
            v-model="form.accessAudience"
            class="field min-w-0"
            autocomplete="off"
            spellcheck="false"
          >
        </label>
        <label
          v-if="!access.session.multiUserEnabled"
          class="grid min-w-0 gap-1 text-xs font-semibold sm:col-span-2"
        >
          Confirma tu email de Access
          <input
            v-model="accessConfirmationEmail"
            class="field min-w-0"
            type="email"
            autocomplete="email"
            spellcheck="false"
          >
        </label>
      </div>
      <label class="flex items-start gap-3">
        <input
          type="checkbox"
          class="mt-1 h-4 w-4 accent-[var(--color-brand-500)]"
          :checked="access.session.multiUserEnabled"
          :disabled="access.session.multiUserEnabled || !access.session.canActivate || activatingUsers || !accessConfirmationEmail.trim() || !form.accessTeamDomain.trim() || !form.accessAudience.trim()"
          @change="activateUsers"
        >
        <span>
          <span class="block text-sm font-semibold">Usar configuración por usuarios</span>
          <span class="block text-xs text-[var(--color-fg-muted)]">
            <template v-if="access.session.multiUserEnabled">
              Activa permanentemente. Usuario actual: {{ access.session.identity?.email }}<template v-if="access.session.isAdmin"> · administrador</template>.
            </template>
            <template v-else>
              Al activar, el usuario del token que coincida con el email confirmado recibirá todos los datos existentes y será administrador.
            </template>
          </span>
        </span>
      </label>
      <p class="mt-3 text-xs text-[var(--color-fg-muted)]">
        Se comprueban firma, emisor, audience y caducidad. El token completo no se guarda ni se muestra.
      </p>
      <div v-if="access.session.multiUserEnabled && access.session.isAdmin" class="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          class="btn-ghost"
          :disabled="updatingAccessConfiguration || !form.accessTeamDomain.trim() || !form.accessAudience.trim()"
          @click="saveAccessConfiguration"
        >
          {{ updatingAccessConfiguration ? 'Validando…' : 'Actualizar Cloudflare Access' }}
        </button>
      </div>
      <p v-if="accessMessage" class="mt-2 text-xs text-emerald-600" role="status">{{ accessMessage }}</p>
      <p v-if="accessError" class="mt-2 text-xs text-red-500" role="alert">{{ accessError }}</p>

      <div
        v-if="access.session.multiUserEnabled"
        class="settings-subpanel mt-6 min-w-0 rounded-2xl border border-[var(--color-border-soft)] p-4"
        data-testid="identity-reassignment"
      >
        <h3 class="font-semibold">Reasignar identidad Access</h3>
        <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
          Mueve ambas colecciones y todos sus recursos de un sub antiguo a otro ya reconocido por esta instancia. No mezcla datos existentes del destino.
        </p>
        <p v-if="access.session.identity" class="mt-3 min-w-0 text-xs text-[var(--color-fg-muted)]">
          Identidad actual:
          <strong>{{ access.session.identity.email }}</strong>
          · <code class="break-all">{{ access.session.identity.id }}</code>
        </p>

        <div class="mt-4 grid min-w-0 gap-4 lg:grid-cols-2">
          <fieldset class="grid min-w-0 gap-3 rounded-xl border border-[var(--color-border-soft)] p-3">
            <legend class="px-1 text-sm font-semibold">Identidad anterior</legend>
            <label class="grid min-w-0 gap-1 text-xs font-semibold">
              Sub anterior
              <input
                v-model="identityTransfer.sourceId"
                class="field min-w-0"
                autocomplete="off"
                spellcheck="false"
              >
            </label>
            <label class="grid min-w-0 gap-1 text-xs font-semibold">
              Email anterior
              <input
                v-model="identityTransfer.sourceEmail"
                class="field min-w-0"
                type="email"
                autocomplete="off"
                spellcheck="false"
              >
            </label>
          </fieldset>

          <fieldset class="grid min-w-0 gap-3 rounded-xl border border-[var(--color-border-soft)] p-3">
            <legend class="px-1 text-sm font-semibold">Identidad actual</legend>
            <label class="grid min-w-0 gap-1 text-xs font-semibold">
              Sub de destino
              <input
                v-model="identityTransfer.destinationId"
                class="field min-w-0"
                autocomplete="off"
                spellcheck="false"
                :readonly="!access.session.isAdmin"
              >
            </label>
            <label class="grid min-w-0 gap-1 text-xs font-semibold">
              Email de destino
              <input
                v-model="identityTransfer.destinationEmail"
                class="field min-w-0"
                type="email"
                autocomplete="off"
                spellcheck="false"
                :readonly="!access.session.isAdmin"
              >
            </label>
          </fieldset>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            class="btn-ghost"
            :disabled="!canPreviewIdentityTransfer"
            @click="previewIdentityTransfer"
          >
            {{ identityTransferAction === 'preview' ? 'Revisando…' : 'Previsualizar' }}
          </button>
          <button
            v-if="identityTransferPreview"
            type="button"
            class="btn-danger"
            :disabled="identityTransferAction !== null"
            @click="confirmIdentityTransfer"
          >
            {{ identityTransferAction === 'reassign' ? 'Reasignando…' : 'Confirmar reasignación' }}
          </button>
        </div>

        <div
          v-if="identityTransferPreview"
          class="mt-4 rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-alt)] p-3 text-sm"
          data-testid="identity-reassignment-preview"
        >
          <p class="font-semibold">
            {{ identityTransferPreview.affected.total }} registros afectados
          </p>
          <div class="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">Colección normal</p>
              <ul v-if="affectedIdentityEntries(identityTransferPreview.affected.normal).length" class="mt-1 list-disc pl-5">
                <li v-for="entry in affectedIdentityEntries(identityTransferPreview.affected.normal)" :key="entry.resource">
                  {{ entry.count }} {{ entry.label }}
                </li>
              </ul>
              <p v-else class="mt-1 text-xs text-[var(--color-fg-muted)]">Sin datos</p>
            </div>
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">Colección privada</p>
              <ul v-if="affectedIdentityEntries(identityTransferPreview.affected.private).length" class="mt-1 list-disc pl-5">
                <li v-for="entry in affectedIdentityEntries(identityTransferPreview.affected.private)" :key="entry.resource">
                  {{ entry.count }} {{ entry.label }}
                </li>
              </ul>
              <p v-else class="mt-1 text-xs text-[var(--color-fg-muted)]">Sin datos</p>
            </div>
          </div>
          <p v-if="identityTransferPreview.affected.userSettings" class="mt-2">
            Ajustes personales: {{ identityTransferPreview.affected.userSettings }}
          </p>
          <p v-if="identityTransferPreview.movesAdministrator" class="mt-2 font-semibold text-amber-600 dark:text-amber-300">
            La administración de la instancia también pasará al destino.
          </p>
        </div>

        <p v-if="identityTransferError" class="mt-3 text-xs text-red-500" role="alert">
          {{ identityTransferError }}
        </p>
        <p v-if="identityTransferMessage" class="mt-3 break-all text-xs text-emerald-600" role="status">
          {{ identityTransferMessage }}
        </p>
        <p class="mt-4 text-xs text-[var(--color-fg-muted)]">
          Recuperación del administrador: accede con la nueva identidad que conserve el email administrador, indica arriba el sub y email anteriores y usa la identidad actual como destino. Solo esa coincidencia permite recuperar la administración sin ser todavía administrador.
        </p>
      </div>
    </section>

    <section
      id="llm"
      class="settings-panel"
      :class="[
        { 'settings-panel-active': activeSectionId === 'llm' },
        { 'opacity-60': !canManageGlobal }
      ]"
      :inert="!canManageGlobal"
      :aria-disabled="!canManageGlobal"
      data-testid="llm-settings"
    >
      <h2>LLM</h2>
      <p>
        Generación de texto para historias con Chrome o LMStudio.
      </p>
      <div class="settings-panel-content grid min-w-0 gap-5">
      <label v-if="privacy.isPrivate" class="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          autocomplete="off"
          class="mt-1 h-4 w-4 accent-[var(--color-brand-500)]"
          :checked="privateLlmSettingsEnabled"
          :disabled="switchingPrivateLlmSettings"
          @change="setPrivateLlmSettingsEnabled(($event.target as HTMLInputElement).checked)"
        >
        <span>
          <span class="block text-sm font-semibold">Personalizar ajustes de LMStudio</span>
          <span class="block text-xs text-[var(--color-fg-muted)]">
            Al activarlo copia los valores normales. Al desactivarlo vuelve a heredarlos.
          </span>
        </span>
      </label>
      <div>
        <label class="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            autocomplete="off"
            class="mt-1 h-4 w-4 accent-[var(--color-brand-500)]"
            :checked="settings.settings.mockMode"
            @change="setMockMode(($event.target as HTMLInputElement).checked)"
          >
          <span>
            <span class="block text-sm font-semibold">Modo prueba (sin LLM)</span>
            <span class="block text-xs text-[var(--color-fg-muted)]">
              Las historias responden texto aleatorio con el formato de siempre. No se llama a
              LMStudio.
            </span>
          </span>
        </label>
      </div>

      <div>
        <label class="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            autocomplete="off"
            class="mt-1 h-4 w-4 accent-[var(--color-brand-500)]"
            :checked="chromeLlmEnabled"
            :disabled="chromeLlmPreparing"
            @change="setChromeLlmEnabled(($event.target as HTMLInputElement).checked)"
          >
          <span class="min-w-0">
            <span class="block text-sm font-semibold">Usar IA local de Chrome</span>
            <span class="block text-xs text-[var(--color-fg-muted)]">
              <template v-if="privacy.isPrivate">
                Ajuste exclusivo del modo privado. Hereda el valor normal hasta cambiarlo.
              </template>
              <template v-else>
                Usa la Prompt API y Gemini Nano dentro del navegador. No envía la historia a LMStudio.
              </template>
            </span>
            <span class="mt-1 block text-xs" aria-live="polite">
              <template v-if="chromeLlmPreparing">
                Preparando modelo<span v-if="chromeLlmProgress !== null">: {{ chromeLlmProgress }}%</span>…
              </template>
              <template v-else-if="chromeLlmAvailability === 'checking'">Comprobando compatibilidad…</template>
              <template v-else-if="chromeLlmAvailability === 'available'">Modelo local preparado.</template>
              <template v-else-if="chromeLlmAvailability === 'downloadable'">Compatible; falta descargar el modelo.</template>
              <template v-else-if="chromeLlmAvailability === 'downloading'">Descarga del modelo en curso.</template>
              <template v-else-if="chromeLlmAvailability === 'unavailable'">No disponible en este navegador o equipo.</template>
            </span>
            <span v-if="chromeLlmError" class="mt-1 block text-xs text-red-500" role="alert">
              {{ chromeLlmError }}
            </span>
          </span>
        </label>
      </div>

      <p v-if="chromeLlmEnabled" class="text-xs text-[var(--color-fg-muted)]">
        URL, token, modelo, temperatura y máximo de tokens solo se aplican a LMStudio y quedan
        guardados para cuando desactives Chrome.
      </p>

      <div>
        <label class="label" for="baseUrl">URL del servidor (LMStudio)</label>
        <div class="flex gap-2">
          <input
            id="baseUrl"
            v-model="form.baseUrl"
            :disabled="privacy.isPrivate && !privateLlmSettingsEnabled"
            autocomplete="off"
            class="field min-w-0 flex-1"
            placeholder="http://localhost:1234"
          >
          <button
            type="button"
            class="btn-ghost flex h-10 w-10 shrink-0 items-center justify-center gap-2 px-0 sm:w-auto sm:px-3"
            :aria-label="testing ? 'Probando conexión' : 'Probar conexión'"
            :title="testing ? 'Probando conexión' : 'Probar conexión'"
            :disabled="testing"
            @click="testConnection"
          >
            <svg
              aria-hidden="true"
              class="h-4 w-4"
              :class="{ 'animate-pulse': testing }"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M8 4v5M16 4v5M7 9h10v1a5 5 0 0 1-10 0V9Zm5 6v5" />
            </svg>
            <span class="hidden sm:inline">{{ testing ? 'Probando…' : 'Probar conexión' }}</span>
          </button>
        </div>
        <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
          Sin `/v1` al final. El servidor de Mis Historias conecta con LM Studio.
        </p>
        <p v-if="testMessage" class="mt-1 text-xs text-brand-600">{{ testMessage }}</p>
        <p v-if="testError" class="mt-1 text-xs text-red-500">{{ testError }}</p>
      </div>

      <div>
        <label class="label" for="apiKey">Token de acceso (opcional)</label>
        <div class="flex gap-2">
          <input
            id="apiKey"
            v-model="form.apiKey"
            :disabled="privacy.isPrivate && !privateLlmSettingsEnabled"
            type="password"
            autocomplete="off"
            class="field min-w-0 flex-1"
            :placeholder="form.apiKeyConfigured ? '****' : 'Solo si LMStudio pide API key'"
            @input="onApiKeyInput"
          >
          <button
            v-if="form.apiKeyConfigured"
            type="button"
            class="btn-ghost flex h-10 w-10 shrink-0 items-center justify-center px-0"
            aria-label="Quitar token"
            title="Quitar token"
            :disabled="privacy.isPrivate && !privateLlmSettingsEnabled"
            @click="clearApiKey"
          >
            <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" />
            </svg>
          </button>
        </div>
        <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
          Se guarda en SQLite sin cifrar. Mis Historias solo indica si existe; escribe otro para reemplazarlo.
        </p>
      </div>

      <div>
        <label class="label" for="model">Modelo</label>
        <select
          v-if="models.length"
          id="model"
          v-model="form.model"
          class="field"
          :disabled="privacy.isPrivate && !privateLlmSettingsEnabled"
        >
          <option v-if="form.model && !models.includes(form.model)" :value="form.model" disabled>
            {{ form.model }} (no disponible)
          </option>
          <option v-for="model in models" :key="model" :value="model">{{ model }}</option>
        </select>
        <input
          v-else
          id="model"
          v-model="form.model"
          :disabled="privacy.isPrivate && !privateLlmSettingsEnabled"
          autocomplete="off"
          class="field"
          placeholder="nombre-del-modelo"
        >
      </div>

      <div class="grid min-w-0 gap-2">
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="btn-ghost"
            :disabled="testing || modelAction !== null || !form.model.trim() || configuredModelUnavailable"
            @click="preloadModel"
          >
            {{ modelAction === 'load' ? 'Cargando modelo…' : 'Precargar modelo' }}
          </button>
          <button
            type="button"
            class="btn-ghost"
            :disabled="testing || modelAction !== null"
            @click="unloadAllModels"
          >
            {{ modelAction === 'unload-all' ? 'Descargando modelos…' : 'Descargar todos de memoria' }}
          </button>
        </div>
        <p class="text-xs text-[var(--color-fg-muted)]">
          Descarga modelos de la memoria de LM Studio; no borra sus archivos.
        </p>
        <p v-if="modelActionMessage" class="text-xs text-brand-600" role="status">
          {{ modelActionMessage }}
        </p>
        <p v-if="modelActionError" class="text-xs text-red-500" role="alert">
          {{ modelActionError }}
        </p>
      </div>

      <div class="grid gap-4 sm:grid-cols-3">
        <div>
          <label class="label" for="temperature">Temperatura</label>
          <input
            id="temperature"
            v-model.number="form.temperature"
            :disabled="privacy.isPrivate && !privateLlmSettingsEnabled"
            type="number"
            autocomplete="off"
            step="0.1"
            min="0"
            max="2"
            class="field"
          >
        </div>
        <div>
          <label class="label" for="maxTokens">Máx. tokens</label>
          <input
            id="maxTokens"
            v-model.number="form.maxTokens"
            :disabled="privacy.isPrivate && !privateLlmSettingsEnabled"
            type="number"
            autocomplete="off"
            min="64"
            class="field"
          >
        </div>
        <div>
          <label class="label" for="historyBudget">Historial (caracteres)</label>
          <input
            id="historyBudget"
            v-model.number="form.historyBudget"
            :disabled="privacy.isPrivate && !privateLlmSettingsEnabled"
            type="number"
            autocomplete="off"
            min="0"
            step="1000"
            class="field"
          >
          <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
            Usa 0 para enviar todo el historial disponible.
          </p>
        </div>
      </div>

      </div>
    </section>

    <section
      id="prompt-narrativo"
      class="settings-panel"
      :class="[
        { 'settings-panel-active': activeSectionId === 'prompt-narrativo' },
        { 'opacity-60': !canManageGlobal }
      ]"
      :inert="!canManageGlobal"
      :aria-disabled="!canManageGlobal"
      data-testid="narrative-prompt-settings"
    >
      <h2>Prompt narrativo</h2>
      <p>
        Prompt usado para preparar cada historia. Si no lo personalizas, se usa el integrado en el código.
      </p>
      <textarea
        v-model="narrativePrompt"
        class="field min-h-64 w-full font-mono text-sm"
        aria-label="Prompt narrativo integrado"
        @input="onNarrativePromptInput"
      />
      <button
        v-if="narrativePromptCustomized"
        type="button"
        class="btn mt-3"
        @click="revertNarrativePrompt"
      >
        Revertir a prompt por defecto
      </button>
    </section>

    <section
      id="swarmui"
      class="settings-panel"
      :class="{ 'settings-panel-active': activeSectionId === 'swarmui' }"
      data-testid="swarm-settings"
    >
      <h2>SwarmUI</h2>
      <p>
        Generación manual de imágenes. No se usa durante las historias.
      </p>
      <div class="settings-panel-content grid min-w-0 gap-4">
        <div
          class="grid min-w-0 gap-4"
          :class="{ 'opacity-60': !canManageGlobal }"
          :inert="!canManageGlobal"
          :aria-disabled="!canManageGlobal"
        >
          <div>
            <label class="label" for="swarmBaseUrl">URL de SwarmUI</label>
            <div class="flex min-w-0 gap-2">
              <input
                id="swarmBaseUrl"
                v-model="form.swarmBaseUrl"
                autocomplete="off"
                class="field min-w-0 flex-1"
                placeholder="http://localhost:7801"
              >
              <button
                v-if="form.swarmBaseUrl.trim()"
                type="button"
                class="btn-ghost flex h-10 w-10 shrink-0 items-center justify-center gap-2 px-0 sm:w-auto sm:px-3"
                :aria-label="swarmTesting ? 'Probando conexión' : 'Probar conexión'"
                :title="swarmTesting ? 'Probando conexión' : 'Probar conexión'"
                :disabled="swarmTesting"
                @click="testSwarmConnection"
              >
                <svg
                  aria-hidden="true"
                  class="h-4 w-4"
                  :class="{ 'animate-pulse': swarmTesting }"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M8 4v5M16 4v5M7 9h10v1a5 5 0 0 1-10 0V9Zm5 6v5" />
                </svg>
                <span class="hidden sm:inline">{{ swarmTesting ? 'Probando…' : 'Probar conexión' }}</span>
              </button>
            </div>
          </div>

          <template v-if="form.swarmBaseUrl.trim()">
            <div>
              <label class="label" for="swarmAuthToken">Token de SwarmUI (opcional)</label>
              <div class="flex min-w-0 gap-2">
                <input
                  id="swarmAuthToken"
                  v-model="form.swarmAuthToken"
                  type="password"
                  autocomplete="off"
                  class="field min-w-0 flex-1"
                  :placeholder="form.swarmAuthConfigured ? '****' : 'swarm_token'"
                  @input="onSwarmAuthTokenInput"
                >
                <button
                  v-if="form.swarmAuthConfigured"
                  type="button"
                  class="btn-ghost flex h-10 w-10 shrink-0 items-center justify-center px-0"
                  aria-label="Quitar token SwarmUI"
                  title="Quitar token SwarmUI"
                  @click="clearSwarmAuthToken"
                >
                  <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" />
                  </svg>
                </button>
              </div>
              <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
                Se guarda separado en SQLite y se envía como cookie <code>swarm_token</code>. Solo se indica si existe.
              </p>
            </div>

            <p v-if="swarmTestMessage" class="text-xs text-brand-600" role="status">
              {{ swarmTestMessage }}
            </p>
            <p v-if="swarmTestError" class="text-xs text-red-500" role="alert">
              {{ swarmTestError }}
            </p>

            <div v-if="swarmCatalog" class="grid gap-3 md:grid-cols-3">
              <div>
                <label class="label" for="swarmTestPreset">Preset de prueba</label>
                <select id="swarmTestPreset" v-model="swarmTestPreset" class="field">
                  <option value="">Sin preset</option>
                  <option v-for="preset in swarmCatalog.presets" :key="preset" :value="preset">
                    {{ preset }}
                  </option>
                </select>
              </div>
              <div>
                <label class="label" for="swarmTestModel">Modelo de prueba</label>
                <select id="swarmTestModel" v-model="swarmTestModel" class="field">
                  <option value="">Selecciona un modelo</option>
                  <option v-for="model in swarmCatalog.models" :key="model" :value="model">
                    {{ model }}
                  </option>
                </select>
              </div>
              <div>
                <label class="label" for="swarmTestLora">LoRA de prueba</label>
                <select id="swarmTestLora" v-model="swarmTestLora" class="field">
                  <option value="">Sin LoRA</option>
                  <option v-for="lora in swarmCatalog.loras" :key="lora" :value="lora">
                    {{ lora }}
                  </option>
                </select>
              </div>
            </div>

            <div>
              <label class="label" for="swarmTestPrompt">Prompt de prueba</label>
              <textarea
                id="swarmTestPrompt"
                v-model="swarmTestPrompt"
                class="field min-h-24"
                autocomplete="off"
              />
            </div>
          </template>
        </div>

        <div class="flex flex-wrap items-center gap-2" data-testid="swarm-dialog-actions">
          <button
            v-if="form.swarmBaseUrl.trim()"
            type="button"
            class="btn-primary"
            :disabled="!canManageGlobal || swarmGenerating || !swarmTestPrompt.trim()"
            @click="generateSwarmPreview"
          >
            {{ swarmGenerating ? 'Generando…' : 'Generar imagen de prueba' }}
          </button>
          <button type="button" class="btn-ghost" @click="openSettingsDialog('prompt-referencia-personaje')">
            Prompt de referencia
          </button>
          <button type="button" class="btn-ghost" @click="openSettingsDialog('prompts-swarmui')">
            Prompts SwarmUI
          </button>
        </div>

        <div v-if="swarmPreviewUrl" data-testid="swarm-test-preview">
          <ImageLightbox
            :src="swarmPreviewUrl"
            alt="Resultado temporal de SwarmUI"
            container-class="w-fit"
            image-class="max-h-96 max-w-full rounded-lg object-contain"
          />
        </div>
      </div>
    </section>

    <section
      id="actualizaciones"
      class="settings-panel"
      :class="{ 'settings-panel-active': activeSectionId === 'actualizaciones' }"
      data-testid="app-update-settings"
    >
      <h2>Actualizaciones</h2>
      <p>Comprueba la versión instalada y accede al actualizador cuando esté disponible.</p>
      <div class="settings-panel-content">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0 text-sm">
            <p>
              <span class="font-semibold">Versión instalada:</span>
              <span class="ml-1 break-all">{{ appUpdate.info.value?.currentVersion || 'Comprobando…' }}</span>
            </p>
            <p v-if="appUpdate.info.value?.latestVersion" class="mt-1">
              <span class="font-semibold">Última versión:</span>
              <span class="ml-1 break-all">{{ appUpdate.info.value.latestVersion }}</span>
              <span v-if="appUpdate.info.value.publishedAt" class="text-[var(--color-fg-muted)]">
                · {{ formatReleaseDate(appUpdate.info.value.publishedAt) }}
              </span>
            </p>
            <p v-else-if="appUpdate.checked.value && !appUpdate.error.value" class="mt-1 text-[var(--color-fg-muted)]">
              No hay releases publicadas todavía.
            </p>
            <p
              v-if="appUpdate.info.value?.currentVersion === 'dev'"
              class="mt-2 text-[var(--color-fg-muted)]"
              role="status"
            >
              Compilación de desarrollo; comparación desactivada.
            </p>
            <p
              v-else-if="appUpdate.info.value?.updateAvailable"
              class="mt-2 font-semibold text-brand-600"
              role="status"
            >
              Hay una actualización disponible.
            </p>
            <p v-else-if="appUpdate.info.value?.latestVersion" class="mt-2 text-[var(--color-fg-muted)]" role="status">
              Aplicación actualizada.
            </p>
            <p v-if="appUpdate.error.value" class="mt-2 text-red-500" role="alert">
              {{ appUpdate.error.value }}
            </p>
          </div>
          <div class="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              class="btn-ghost"
              :disabled="appUpdate.pending.value"
              @click="refreshAppUpdate"
            >
              {{ appUpdate.pending.value ? 'Comprobando…' : 'Comprobar ahora' }}
            </button>
            <a
              v-if="appUpdate.info.value?.updateAvailable && appUpdate.info.value.updaterUrl"
              class="btn-primary"
              :href="appUpdate.info.value.updaterUrl"
              rel="noopener noreferrer"
            >
              Descargar actualizador
            </a>
          </div>
        </div>
      </div>
    </section>

    <section
      id="datos"
      class="settings-panel"
      :class="{ 'settings-panel-active': activeSectionId === 'datos' }"
    >
      <h2>Datos</h2>
      <p>
        <template v-if="access.session.multiUserEnabled">
          Tus datos se guardan en SQLite aislados por usuario. Solo los recursos demo compartidos son visibles en modo privado.
        </template>
        <template v-else>
          Todo se guarda en SQLite y se comparte con los equipos que usan este servidor.
        </template>
      </p>
      <div class="flex flex-wrap gap-2">
        <div class="flex shrink-0 flex-col items-center gap-1">
          <button type="button" class="btn-ghost" @click="doExport">Exportar JSON</button>
          <button
            type="button"
            class="h-10 w-12 opacity-0"
            aria-label="Alternar modo demo"
            :disabled="privacy.switching"
            @click="onDemoTrigger"
          />
        </div>
        <input ref="importInput" type="file" accept="application/json" autocomplete="off" class="hidden" @change="onImportFile" >
        <button type="button" class="btn-ghost" :disabled="importing" @click="importInput?.click()">
          {{ importing ? 'Importando…' : 'Importar JSON' }}
        </button>
        <NuxtLink to="/dev/test-data" class="btn-ghost">Datos de prueba</NuxtLink>
        <NuxtLink to="/lora-assistant" class="btn-ghost">Asistente LoRA</NuxtLink>
      </div>

      <p v-if="importMessage" class="mt-2 text-xs text-[var(--color-fg-muted)]">{{ importMessage }}</p>

      <div
        v-if="canManageGlobal"
        class="settings-subpanel mt-6 flex flex-col gap-3 rounded-2xl border border-[var(--color-border-soft)] p-4 sm:flex-row sm:items-center sm:justify-between"
        data-testid="error-traces-settings-card"
      >
        <div>
          <h3 class="font-semibold">Trazas de error</h3>
          <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
            Consulta fallos operativos persistentes. Pueden incluir contenido privado; las credenciales reconocibles se ocultan.
          </p>
        </div>
        <NuxtLink to="/error-traces" class="btn-ghost shrink-0">Abrir trazas</NuxtLink>
      </div>

      <div
        v-if="canManageGlobal"
        class="settings-subpanel mt-6 rounded-2xl border border-[var(--color-border-soft)] p-4"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold">Backups SQLite</h3>
            <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
              Incluyen colección normal, colección privada, ajustes y secretos. Trátalos como archivos sensibles.
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <input
              ref="backupImportInput"
              data-testid="backup-upload-input"
              type="file"
              accept=".sqlite,application/vnd.sqlite3,application/x-sqlite3"
              autocomplete="off"
              class="hidden"
              @change="uploadBackup"
            >
            <button
              type="button"
              class="btn-ghost"
              :disabled="backupAction !== null"
              @click="backupImportInput?.click()"
            >
              {{ backupAction === 'upload' ? 'Subiendo…' : 'Subir backup' }}
            </button>
            <button
              type="button"
              class="btn-primary"
              :disabled="backupAction !== null"
              @click="createBackup"
            >
              {{ backupAction === 'create' ? 'Creando…' : 'Crear backup' }}
            </button>
          </div>
        </div>

        <p v-if="backupMessage" class="mt-3 break-words text-xs text-brand-600" role="status">
          {{ backupMessage }}
        </p>
        <p v-if="backupError" class="mt-3 text-xs text-red-500" role="alert">
          {{ backupError }}
        </p>
        <p v-if="backupsLoading" class="mt-4 text-sm text-[var(--color-fg-muted)]">
          Cargando backups…
        </p>
        <p v-else-if="backups.length === 0" class="mt-4 text-sm text-[var(--color-fg-muted)]">
          No hay backups todavía.
        </p>
        <ul v-else class="mt-4 divide-y divide-[var(--color-border-soft)]" data-testid="backup-list">
          <li
            v-for="backup in backups"
            :key="backup.name"
            class="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="rounded-full bg-brand-500/10 px-2 py-0.5 text-xs font-semibold text-brand-600">
                  {{ backupKindLabel(backup.kind) }}
                </span>
                <span v-if="!backup.valid" class="text-xs font-semibold text-red-500">
                  No válido
                </span>
              </div>
              <p class="mt-1 break-all text-sm font-medium">{{ backup.name }}</p>
              <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
                {{ formatBackupDate(backup.createdAt) }} · {{ formatBackupSize(backup.size) }}
                <template v-if="backup.schemaVersion !== null"> · Esquema v{{ backup.schemaVersion }}</template>
              </p>
            </div>
            <div class="flex shrink-0 flex-wrap gap-2 self-start sm:self-auto">
              <a
                class="btn-ghost"
                :href="databaseBackupDownloadUrl(backup.name)"
                :download="backup.name"
              >
                Descargar
              </a>
              <button
                type="button"
                class="btn-danger"
                :disabled="!backup.valid || backupAction !== null"
                @click="restoreBackup(backup)"
              >
                {{ backupAction === `restore:${backup.name}` ? 'Restaurando…' : 'Restaurar' }}
              </button>
            </div>
          </li>
        </ul>
      </div>
      <p
        v-else
        class="settings-subpanel mt-6 rounded-2xl border border-[var(--color-border-soft)] p-4 text-sm text-[var(--color-fg-muted)]"
      >
        Los backups SQLite contienen toda la instancia y solo están disponibles para el administrador.
      </p>
    </section>

    <SettingsDialog
      :open="activeSettingsDialog === 'prompt-referencia-personaje'"
      title="Prompt de referencia de personaje"
      title-id="character-reference-prompt-dialog-title"
      :busy="settingsDialogBusy"
      @close="closeSettingsDialog"
    >
      <div data-testid="character-reference-prompt-settings">
        <p class="text-sm text-[var(--color-fg-muted)]">
          Instrucción enviada al modelo visual para deducir un prompt visual base desde una foto.
          Si no la personalizas, se usa la integrada en el código.
        </p>
        <p
          v-if="!canManageGlobal"
          class="mt-3 text-sm font-semibold text-amber-700 dark:text-amber-300"
        >
          Solo el administrador puede modificar este prompt.
        </p>
        <textarea
          v-model="characterReferencePrompt"
          class="field mt-4 min-h-64 w-full font-mono text-sm"
          aria-label="Prompt de referencia de personaje integrado"
          :disabled="!canManageGlobal"
          data-dialog-autofocus
          @input="onCharacterReferencePromptInput"
        />
        <div class="mt-3 flex min-h-10 flex-wrap items-center gap-3">
          <button
            v-if="characterReferencePromptCustomized"
            type="button"
            class="btn"
            :disabled="!canManageGlobal"
            @click="revertCharacterReferencePrompt"
          >
            Revertir prompt de referencia por defecto
          </button>
          <template v-if="activeSettingsDialog === 'prompt-referencia-personaje'">
            <span v-if="saveStatus === 'saving'" class="text-xs text-[var(--color-fg-muted)]">
              Guardando…
            </span>
            <span v-else-if="saveStatus === 'saved'" class="text-xs text-[var(--color-fg-muted)]">
              Guardado
            </span>
            <span v-else-if="saveStatus === 'error'" class="text-xs text-red-500" role="alert">
              {{ saveError || 'Error al guardar' }}
            </span>
          </template>
        </div>
      </div>
    </SettingsDialog>

    <SettingsDialog
      :open="activeSettingsDialog === 'prompts-swarmui'"
      title="Prompts SwarmUI"
      title-id="swarm-prompts-dialog-title"
      size="wide"
      :busy="settingsDialogBusy"
      @close="closeSettingsDialog"
    >
      <div data-testid="swarm-prompt-settings">
        <p class="mb-4 text-sm text-[var(--color-fg-muted)]">
          Gestiona los prompts predefinidos usados para crear conjuntos de imágenes.
        </p>
        <SwarmPromptSettings ref="swarmPromptSettingsRef" />
      </div>
    </SettingsDialog>
  </div>
</template>

<style scoped>
.settings-page {
  counter-reset: settings-section;
}

.settings-nav-shell,
.settings-panel {
  width: min(100%, 76rem);
}

.settings-nav-shell {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-canvas) 96%, transparent) 72%,
    transparent
  );
  backdrop-filter: blur(14px);
}

.settings-section-nav {
  scrollbar-width: none;
  cursor: grab;
  box-shadow: 0 12px 36px color-mix(in srgb, var(--color-fg) 7%, transparent);
  backdrop-filter: blur(18px) saturate(130%);
}

.settings-section-nav-dragging {
  cursor: grabbing;
  user-select: none;
}

.settings-section-nav::-webkit-scrollbar {
  display: none;
}

.settings-nav-link {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  border: 1px solid transparent;
  background: color-mix(in srgb, var(--color-surface-alt) 62%, transparent);
  transition: color 180ms ease, background-color 180ms ease, border-color 180ms ease,
    box-shadow 180ms ease, transform 180ms ease;
}

.settings-nav-link:hover {
  border-color: color-mix(in srgb, var(--color-brand-400) 28%, transparent);
  background: color-mix(in srgb, var(--color-brand-500) 9%, var(--color-surface-elevated));
}

.settings-nav-link-active {
  border-color: color-mix(in srgb, var(--color-brand-300) 55%, transparent);
  background: linear-gradient(135deg, var(--color-brand-600), var(--color-brand-500));
  color: white;
  box-shadow: 0 8px 20px color-mix(in srgb, var(--color-brand-600) 25%, transparent);
  transform: translateY(-1px);
}

.settings-nav-index {
  display: inline-flex;
  min-width: 1.5rem;
  height: 1.25rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.45rem;
  background: color-mix(in srgb, currentColor 10%, transparent);
  font-size: 0.6rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  opacity: 0.82;
}

.settings-nav-link-active .settings-nav-index {
  background: rgb(255 255 255 / 16%);
  opacity: 1;
}

.settings-panel {
  position: relative;
  counter-increment: settings-section;
  scroll-margin-top: 6.75rem;
  overflow: hidden;
  margin-top: 1.25rem;
  border: 1px solid var(--color-border-soft);
  border-radius: 1.5rem;
  background: var(--color-surface-elevated);
  padding: 1.5rem;
  box-shadow: var(--shadow-card);
  transition: border-color 220ms ease, box-shadow 220ms ease, background-color 220ms ease;
}

.settings-panel:first-of-type {
  margin-top: 0;
}

.settings-panel::after {
  position: absolute;
  top: 1.25rem;
  bottom: 1.25rem;
  left: 0;
  width: 0.22rem;
  border-radius: 0 999px 999px 0;
  background: linear-gradient(180deg, var(--color-brand-400), var(--color-brand-700));
  content: '';
  opacity: 0;
  transform: scaleY(0.35);
  transition: opacity 220ms ease, transform 220ms ease;
}

.settings-panel-active {
  border-color: color-mix(in srgb, var(--color-brand-400) 60%, var(--color-border-soft));
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--color-brand-500) 5%, transparent),
      transparent 34%
    ),
    var(--color-surface-elevated);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-brand-400) 12%, transparent),
    var(--shadow-card-hover);
}

.settings-panel-active::after {
  opacity: 1;
  transform: scaleY(1);
}

.settings-panel > h2 {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin: 0;
  color: var(--color-fg);
  font-size: 1.2rem;
  font-weight: 750;
  letter-spacing: -0.025em;
}

.settings-panel > h2::before {
  display: inline-flex;
  width: 2rem;
  height: 2rem;
  flex: none;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--color-brand-400) 24%, var(--color-border-soft));
  border-radius: 0.7rem;
  background: color-mix(in srgb, var(--color-brand-500) 9%, transparent);
  color: var(--color-brand-600);
  content: counter(settings-section, decimal-leading-zero);
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  transition: color 220ms ease, background-color 220ms ease, border-color 220ms ease;
}

.settings-panel-active > h2::before {
  border-color: var(--color-brand-500);
  background: var(--color-brand-600);
  color: white;
}

.settings-panel > p {
  margin: 0.55rem 0 1.25rem 2.7rem;
  color: var(--color-fg-muted);
  font-size: 0.875rem;
  line-height: 1.55;
}

.settings-panel-content {
  min-width: 0;
}

.settings-subpanel {
  background: color-mix(in srgb, var(--color-surface-alt) 56%, transparent);
}

@media (max-width: 639px) {
  .settings-panel {
    scroll-margin-top: 8.5rem;
    border-radius: 1.25rem;
    padding: 1.1rem;
  }

  .settings-panel > p {
    margin-left: 0;
  }
}
</style>
