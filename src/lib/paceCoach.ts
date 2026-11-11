/**
 * Pace corrections during a training session's steps (#103). Pure functions, no Vue, like
 * `stepCues.ts`: what is said and when comes from the run's own totals (elapsed time without
 * pauses, filtered distance), never from the wall clock.
 */
import { MAX_SPEED_MPS, MIN_MOVING_SPEED_MPS } from './runStats'
import { WARN_LEAD_M, WARN_LEAD_S } from './stepCues'
import type { RunStep, StepTotals } from './stepProgress'

/** Starting values, to tune on real runs */
export const PACE_COACH_CONFIG = {
  /** Pace is averaged over this much run time before it is judged */
  windowS: 25,
  /** Moving is judged over this short stretch, so stopping at a light silences at once */
  recentS: 5,
  /** How far beyond the target range (s/km) still counts as on pace */
  marginSecPerKm: 10,
  /** How long the pace must stay off before a correction is said */
  sustainS: 20,
  /** The same correction again while the pace is still off */
  reminderS: 60,
  /** Least time between two different corrections */
  cooldownS: 60,
  /** How long back inside the range before "Back on pace" is said */
  backOnPaceS: 10,
}
export type PaceCoachConfig = typeof PACE_COACH_CONFIG

/** Fixed lines with stable keys, so a recorded voice can stand in for them later (#139) */
export const PACE_PHRASES = {
  faster: 'Faster',
  slower: 'Slower',
  onPace: 'Back on pace',
} as const
export type PacePhrase = keyof typeof PACE_PHRASES
type Correction = Exclude<PacePhrase, 'onPace'>

/** Default for "Slowest run pace": slower than this on a run step without a pace is walking */
export const DEFAULT_SLOWEST_RUN_PACE = 540
export const SLOWEST_RUN_PACE_OPTIONS = [480, 540, 600] as const
export type SlowestRunPace = (typeof SLOWEST_RUN_PACE_OPTIONS)[number]

/** Target range in s/km; `fast` is the low number. Either end can be open */
export interface PaceTarget {
  fast: number | null
  slow: number | null
}

interface Sample {
  elapsedMs: number
  distanceM: number
}

export interface PaceCoachState {
  /** Step these timers belong to; a new step starts over */
  position: number
  /** Samples covering the window, oldest first; the first may lie just before it */
  samples: Sample[]
  /** The pace is off in this direction since this run time */
  off: { key: Correction; sinceMs: number } | null
  /** Back inside the range since this run time */
  inRangeSinceMs: number | null
  lastCorrection: { key: Correction; atMs: number } | null
  /** A correction was said and "Back on pace" not yet */
  owesOnPace: boolean
}

export interface PaceCue {
  key: PacePhrase
  text: string
}

export function initPaceCoachState(position: number): PaceCoachState {
  return {
    position,
    samples: [],
    off: null,
    inRangeSinceMs: null,
    lastCorrection: null,
    owesOnPace: false,
  }
}

/**
 * What the step is coached against: its own pace range, or for a run step without one only a
 * slow end. Warm-up, walk, recovery and cool-down are never coached.
 */
export function paceTarget(
  step: Pick<RunStep, 'kind' | 'paceMin' | 'paceMax'>,
  slowestRunPace: number,
): PaceTarget | null {
  if (step.kind !== 'run') return null
  if (step.paceMin === null && step.paceMax === null) return { fast: null, slow: slowestRunPace }
  // A single pace is both ends of its range
  return { fast: step.paceMin ?? step.paceMax, slow: step.paceMax ?? step.paceMin }
}

/**
 * Add the latest totals. A jump faster than any runner (distance arriving at once after a GPS
 * gap) restarts the window, so it never reads as a sprint.
 */
export function addSample(samples: readonly Sample[], next: Sample, windowS: number): Sample[] {
  const last = samples[samples.length - 1]
  if (last && next.elapsedMs <= last.elapsedMs) {
    // Same moment (a fix between timer ticks): keep the newest distance
    return [...samples.slice(0, -1), { elapsedMs: last.elapsedMs, distanceM: next.distanceM }]
  }
  if (last) {
    const speed = (next.distanceM - last.distanceM) / ((next.elapsedMs - last.elapsedMs) / 1000)
    if (speed > MAX_SPEED_MPS) return [next]
  }
  const out = [...samples, next]
  const cutoff = next.elapsedMs - windowS * 1000
  // Keep one sample at or before the cutoff, so the window is measured over its full length
  while (out.length > 1 && out[1]!.elapsedMs <= cutoff) out.shift()
  return out
}

/** Speed in m/s over the last `seconds`, or null until the samples cover all of it */
export function windowSpeed(samples: readonly Sample[], seconds: number): number | null {
  const last = samples[samples.length - 1]
  if (!last) return null
  const cutoff = last.elapsedMs - seconds * 1000
  let from: Sample | undefined
  for (let i = samples.length - 1; i >= 0 && !from; i--) {
    if (samples[i]!.elapsedMs <= cutoff) from = samples[i]
  }
  if (!from) return null
  return (last.distanceM - from.distanceM) / ((last.elapsedMs - from.elapsedMs) / 1000)
}

/** Within the warning lead of the step's end: the step warning is due, so stay quiet */
function nearStepEnd(step: RunStep, totals: StepTotals): boolean {
  if (step.targetValue === null) return false
  if (step.targetKind === 'duration') {
    return totals.elapsedMs >= step.startedElapsedMs + (step.targetValue - WARN_LEAD_S) * 1000
  }
  if (step.targetKind === 'distance') {
    return totals.distanceM >= step.startedDistanceM + step.targetValue - WARN_LEAD_M
  }
  return false
}

const cue = (key: PacePhrase): PaceCue => ({ key, text: PACE_PHRASES[key] })

/**
 * Feed the latest totals of the open step; returns the next state, and the line to say now or
 * null. `speaking` holds a due line back until other speech is over, without losing its timers.
 */
export function nextPaceCue(
  prev: PaceCoachState | null,
  step: RunStep,
  totals: StepTotals,
  slowestRunPace: number,
  speaking: boolean,
  config: PaceCoachConfig = PACE_COACH_CONFIG,
): { state: PaceCoachState; cue: PaceCue | null } {
  // A new step starts its window at its own start, so the previous step's pace never counts
  const base =
    prev && prev.position === step.position
      ? prev
      : {
          ...initPaceCoachState(step.position),
          samples: [{ elapsedMs: step.startedElapsedMs, distanceM: step.startedDistanceM }],
        }
  const now = totals.elapsedMs
  const state: PaceCoachState = { ...base, samples: addSample(base.samples, totals, config.windowS) }
  const none = { state, cue: null }

  const target = paceTarget(step, slowestRunPace)
  if (!target) return none
  const speed = windowSpeed(state.samples, config.windowS)
  const recent = windowSpeed(state.samples, config.recentS)
  if (speed === null || recent === null) {
    return { state: { ...state, off: null, inRangeSinceMs: null }, cue: null }
  }
  // Standing at a crossing (or just stopped there): no corrections, and the wait starts over
  if (speed < MIN_MOVING_SPEED_MPS || recent < MIN_MOVING_SPEED_MPS) {
    return { state: { ...state, off: null, inRangeSinceMs: null }, cue: null }
  }

  const pace = 1000 / speed
  const m = config.marginSecPerKm
  const tooFast = target.fast !== null && pace < target.fast - m
  const tooSlow = target.slow !== null && pace > target.slow + m
  const quiet = speaking || nearStepEnd(step, totals)

  if (tooFast || tooSlow) {
    const key: Correction = tooSlow ? 'faster' : 'slower'
    const off = state.off?.key === key ? state.off : { key, sinceMs: now }
    const next = { ...state, off, inRangeSinceMs: null }
    if (now - off.sinceMs < config.sustainS * 1000 || quiet) return { state: next, cue: null }
    const last = state.lastCorrection
    const wait = last?.key === key ? config.reminderS : config.cooldownS
    if (last && now - last.atMs < wait * 1000) return { state: next, cue: null }
    return {
      state: { ...next, lastCorrection: { key, atMs: now }, owesOnPace: true },
      cue: cue(key),
    }
  }

  const inRange =
    (target.fast === null || pace >= target.fast) && (target.slow === null || pace <= target.slow)
  if (!inRange || !state.owesOnPace) return { state: { ...state, off: null, inRangeSinceMs: null }, cue: null }
  const inRangeSinceMs = state.inRangeSinceMs ?? now
  const next = { ...state, off: null, inRangeSinceMs }
  if (now - inRangeSinceMs < config.backOnPaceS * 1000 || quiet) return { state: next, cue: null }
  return { state: { ...next, owesOnPace: false, inRangeSinceMs: null }, cue: cue('onPace') }
}
