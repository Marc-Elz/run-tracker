import { formatMinSec } from '@/lib/training'

/**
 * Exercise countdown timer (#124). A preset is `rounds` times a work phase, with a rest phase
 * between rounds (none after the last). A plain countdown is one round without rest.
 */
export interface TimerPreset {
  id: string
  name: string
  workS: number
  restS: number
  rounds: number
}

/** The built-in preset: always there and first, editable but never deleted */
export const DEFAULT_PRESET_ID = 'default'
export const DEFAULT_PRESET: TimerPreset = {
  id: DEFAULT_PRESET_ID,
  name: '2 minutes',
  workS: 120,
  restS: 0,
  rounds: 1,
}

export const MIN_WORK_S = 5
export const MAX_ROUNDS = 99
/** Keeps a typo like 999 minutes out; a timed exercise set is never this long */
export const MAX_PHASE_S = 99 * 60

export type PhaseKind = 'work' | 'rest'

export interface Phase {
  kind: PhaseKind
  /** 1-based round the phase belongs to (a rest belongs to the round before it) */
  round: number
  /** Seconds from the start of the set */
  startS: number
  endS: number
}

/** The phases of a preset in order */
export function buildTimeline(preset: TimerPreset): Phase[] {
  const phases: Phase[] = []
  let t = 0
  for (let round = 1; round <= preset.rounds; round++) {
    phases.push({ kind: 'work', round, startS: t, endS: t + preset.workS })
    t += preset.workS
    if (round < preset.rounds && preset.restS > 0) {
      phases.push({ kind: 'rest', round, startS: t, endS: t + preset.restS })
      t += preset.restS
    }
  }
  return phases
}

export function totalSeconds(preset: Omit<TimerPreset, 'id' | 'name'>): number {
  return preset.rounds * preset.workS + Math.max(0, preset.rounds - 1) * preset.restS
}

export interface TimerState {
  /** Index of the current phase; equals the timeline's length once the set is done */
  index: number
  /** Time left in the current phase, 0 when done */
  remainingMs: number
  done: boolean
}

/** Where a set stands after `elapsedMs` of (unpaused) time */
export function timerState(timeline: Phase[], elapsedMs: number): TimerState {
  const index = timeline.findIndex((p) => elapsedMs < p.endS * 1000)
  if (index === -1) return { index: timeline.length, remainingMs: 0, done: true }
  return { index, remainingMs: timeline[index]!.endS * 1000 - elapsedMs, done: false }
}

/** Whole seconds to show: 2:00 at the start, 0:01 until the very end */
export function displaySeconds(remainingMs: number): number {
  return Math.ceil(remainingMs / 1000)
}

/** What is spoken when the phase at `index` starts; past the last phase the set is done */
export function phaseCue(timeline: Phase[], index: number, rounds: number): string {
  const phase = timeline[index]
  if (!phase) return 'Done'
  if (phase.kind === 'rest') return 'Rest'
  return rounds > 1 ? `Round ${phase.round} of ${rounds}, work` : 'Go'
}

/** One line under a preset's name: "2:00" or "0:45 work · 0:15 rest · 4×" */
export function presetDetail(p: TimerPreset): string {
  if (p.rounds === 1) return formatMinSec(p.workS)
  const parts = [`${formatMinSec(p.workS)} work`]
  if (p.restS > 0) parts.push(`${formatMinSec(p.restS)} rest`)
  parts.push(`${p.rounds}×`)
  return parts.join(' · ')
}

/** The name a preset gets when none is typed: "2:00" or "0:45 / 0:15 × 4" */
export function autoPresetName(p: Omit<TimerPreset, 'id' | 'name'>): string {
  if (p.rounds === 1) return formatMinSec(p.workS)
  const work = formatMinSec(p.workS)
  return p.restS > 0 ? `${work} / ${formatMinSec(p.restS)} × ${p.rounds}` : `${work} × ${p.rounds}`
}

/** Why these values can't be a preset, or null when they can */
export function presetError(p: Omit<TimerPreset, 'id' | 'name'>): string | null {
  if (!Number.isInteger(p.workS) || p.workS < MIN_WORK_S || p.workS > MAX_PHASE_S) {
    return 'Enter the work time as min:s, at least 0:05.'
  }
  if (!Number.isInteger(p.restS) || p.restS < 0 || p.restS > MAX_PHASE_S) {
    return 'Enter the rest time as min:s, or pick None.'
  }
  if (!Number.isInteger(p.rounds) || p.rounds < 1 || p.rounds > MAX_ROUNDS) {
    return `Rounds must be 1 to ${MAX_ROUNDS}.`
  }
  return null
}

/** A stored preset as read back, or null when it is malformed */
export function toPreset(raw: unknown): TimerPreset | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { id, name, workS, restS, rounds } = raw as Record<string, unknown>
  if (typeof id !== 'string' || id === '' || typeof name !== 'string') return null
  const values = { workS, restS, rounds } as Omit<TimerPreset, 'id' | 'name'>
  if (presetError(values) !== null) return null
  return { id, name: name.trim() || autoPresetName(values), ...values }
}

/** The list as shown: the default first (restored when missing), then the rest without repeats */
export function withDefaultPreset(presets: TimerPreset[]): TimerPreset[] {
  const seen = new Set<string>()
  const unique = presets.filter((p) => !seen.has(p.id) && seen.add(p.id))
  const def = unique.find((p) => p.id === DEFAULT_PRESET_ID) ?? { ...DEFAULT_PRESET }
  return [def, ...unique.filter((p) => p.id !== DEFAULT_PRESET_ID)]
}
