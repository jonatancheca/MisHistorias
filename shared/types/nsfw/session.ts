export type NsfwStoryFormat = 'story' | 'chat' | 'vn'
export type GenerationProfile = 'quick' | 'quality'
export type InteractionPolicy = 'pause' | 'lite' | 'automatic' | 'non_interactive'
export type AttemptState =
  | 'requested'
  | 'streaming'
  | 'validating'
  | 'ready'
  | 'accepted'
  | 'failed'
  | 'cancelled'
  | 'stale'
  | 'discarded'

export type PlayerInputKind = 'speak' | 'act' | 'free' | 'choice' | 'continue'

export interface StoryBibleFact {
  id: string
  entity: string
  text: string
  secret: boolean
  knownByProtagonist: boolean
  source: string
}

export interface StoryBible {
  version: number
  facts: StoryBibleFact[]
}

export interface StoryPlanBeat {
  id: string
  intent: string
  status: 'pending' | 'done' | 'skipped'
}

export interface StoryPlan {
  version: number
  summary: string
  nextBeats: StoryPlanBeat[]
}

export interface WorldState {
  version: number
  location: string
  presentActorIds: string[]
  mood: string
  relationshipNotes: string[]
  flags: Record<string, string | number | boolean>
}

export interface SceneState {
  location: string
  presentActorIds: string[]
  intention: string
  pacing: string
}

export interface SessionCastMember {
  actorId: string
  name: string
  role: 'protagonist' | 'character' | 'narrator'
  personality: string
  isSelfInsert: boolean
  sourceCharacterId?: string | null
  characterization?: string
  overrideName?: string | null
  preservedRelations?: string[]
}

export interface SessionAssetPins {
  placeId: string | null
  placeBackgroundId: string | null
  characterSprites: Record<string, string>
}

export interface CreateStorySessionInput {
  title: string
  premise: string
  format: NsfwStoryFormat
  duration: string
  tone: string
  perspective: string
  interactionPolicy: InteractionPolicy
  generationProfile: GenerationProfile
  modelAlias: string
  cast: SessionCastMember[]
  interests: string[]
  exclusions: string[]
  planSummary?: string
  experienceId?: string | null
  assetPins?: SessionAssetPins
  styleReference?: string
  storyDirection?: string
  creationSource?: string
  contextual?: string[]
  era?: string
  placeId?: string | null
}

export interface NsfwStorySession {
  id: string
  ownerUserId: string
  format: NsfwStoryFormat
  title: string
  premise: string
  duration: string
  tone: string
  perspective: string
  interactionPolicy: InteractionPolicy
  generationProfile: GenerationProfile
  modelAlias: string
  headBeatId: string | null
  revision: number
  plan: StoryPlan
  bible: StoryBible
  worldState: WorldState
  sceneState: SceneState
  cast: SessionCastMember[]
  interests: string[]
  exclusions: string[]
  archived: boolean
  privacyNoticeSeen: boolean
  parentSessionId: string | null
  forkBeatId: string | null
  sequelOfSessionId: string | null
  branchLabel: string | null
  finalizedAt: number | null
  experienceId: string | null
  assetPins: SessionAssetPins
  escalationHeart: boolean
  createdAt: number
  updatedAt: number
}

export interface PlayerInput {
  kind: PlayerInputKind
  text: string
  choiceId?: string
}

export interface GenerationUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  latencyMs?: number
  passes?: Array<{
    name: string
    ok: boolean
    latencyMs: number
    notes: string
    score?: number
  }>
}

export interface NsfwGenerationAttempt {
  id: string
  sessionId: string
  parentBeatId: string | null
  siblingGroupId: string
  input: PlayerInput
  inputFingerprint: string
  modelAlias: string
  modelId: string
  generationProfile: GenerationProfile
  skillVersions: Record<string, string>
  pipelinePasses: GenerationUsage['passes']
  latencyMs: number
  thumb: 'up' | 'down' | null
  state: AttemptState
  envelope: import('./envelope.ts').GenerationEnvelope | null
  provisionalText: string
  errorMessage: string | null
  usage: GenerationUsage
  retryCount: number
  createdAt: number
  updatedAt: number
}

export interface NsfwNarrativeBeat {
  id: string
  sessionId: string
  parentBeatId: string | null
  acceptedAttemptId: string
  envelope: import('./envelope.ts').GenerationEnvelope
  sequence: number
  createdAt: number
}

export interface SessionPlayState {
  session: NsfwStorySession
  beats: NsfwNarrativeBeat[]
  activeAttempt: NsfwGenerationAttempt | null
  siblingAttempts: NsfwGenerationAttempt[]
}
