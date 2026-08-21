import type { NsfwStoryFormat } from './session.ts'

export type VisibleUnit =
  | { type: 'narration'; text: string }
  | {
      type: 'dialogue'
      actorId: string
      text: string
      spriteQuery?: string[]
      speech?: string
    }

export interface VisualCue {
  kind: 'composition' | 'scene_cg'
  placeId?: string
  spriteQueries?: Array<{ actorId: string; tags: string[] }>
  sceneCgAssetId?: string
}

export interface SoundCue {
  assetId: string
  unitIndex: number
}

export interface SuggestedInteraction {
  id: string
  kind: 'speak' | 'act' | 'choice'
  label: string
  prominence: 'primary' | 'secondary'
}

export type StateOperation =
  | { op: 'set_location'; value: string }
  | { op: 'set_mood'; value: string }
  | { op: 'set_present'; actorIds: string[] }
  | { op: 'set_flag'; key: string; value: string | number | boolean }
  | { op: 'add_relationship_note'; value: string }

export type PlanOperation =
  | { op: 'set_summary'; value: string }
  | { op: 'mark_beat_done'; beatId: string }
  | { op: 'add_beat'; id: string; intent: string }

export type StopReason =
  | 'awaiting_player'
  | 'natural_pause'
  | 'choice_required'
  | 'scene_complete'

export interface GenerationEnvelope {
  schemaVersion: 1
  language: 'es-ES'
  format: NsfwStoryFormat
  visibleUnits: VisibleUnit[]
  visualCues: VisualCue[]
  soundCues: SoundCue[]
  choices: SuggestedInteraction[]
  stateDelta: StateOperation[]
  planPatch: PlanOperation[]
  stopReason: StopReason
}
