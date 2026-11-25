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
  /**
   * Pace is averaged over this much run time before it is judged. Short enough that a 1-minute
   * run step still gets a correction: the first one can come at windowS + sustainS
   */
  windowS: 15,
  /** Moving is judged over this short stretch, so stopping at a light silences within seconds */
  recentS: 6,
  /**
   * Slower than this over `recentS` counts as stopped. Well under a slow jog (about 1.3 m/s),
   * since distance grows in 5 m steps and a slow jog can read near 1 m/s over a few seconds
   */
  stoppedMps: 0.5,
  /** How far beyond the target range (s/km) still counts as on pace */
  marginSecPerKm: 10,
  /** How long the pace must stay off before a correction is said */
  sustainS: 10,
  /** The same correction again while the pace is still off */
  reminderS: 60,
  /** Least time between two different corrections */
  cooldownS: 60,
  /**
   * How long back on pace (within the margin) before "Back on pace" is said. Short, because the
   * windowed pace already lags: on the phone (PR #141) 10 s rarely came, as the GPS pace swings
   * in and out of range, and when it did the cue lagged the running by up to 25 s
   */
  backOnPaceS: 6,
  /**
   * Walk steps are judged by the GPS speed reading (#153) when the window holds at least this
   * many readings per second of it; fewer (readings missing or a GPS gap) falls back to distance
   */
  minReadingsPerS: 0.5,
}
export type PaceCoachConfig = typeof PACE_COACH_CONFIG

/** Fixed lines with stable keys, so a recorded voice can stand in for them later (#139) */
export const PACE_PHRASES = {
  faster: 'Faster',
  slower: 'Slower',
  onPace: 'Back on pace',
  /** Walk steps get their own lines, so a "Faster" there never reads as "run" (#153) */
  walkFaster: 'Walk faster',
  walkSlower: 'Walk slower',
} as const
export type PacePhrase = keyof typeof PACE_PHRASES
type Correction = 'faster' | 'slower'

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
  /** GPS speed reading (m/s) of a fix that arrived at this moment, when it has one */
  speedMps?: number
}

/** The open step's totals, plus the speed reading of a fix new since the last call */
export interface PaceInput extends StepTotals {
  speedMps?: number
}

export interface PaceCoachState {
  /** Step these timers belong to; a new step starts over */
  position: number
  /** Samples covering the window, oldest first; the first may lie just before it */
  samples: Sample[]
  /** The pace is off in this direction since this run time */
  off: { key: Correction; sinceMs: number } | null
  /** Back on pace, within the margin, since this run time */
  onPaceSinceMs: number | null
  lastCorrection: { key: Correction; atMs: number } | null
  /** A correction was said and "Back on pace" not yet */
  owesOnPace: boolean
}

export interface PaceCue {
  key: PacePhrase
  text: string
  /** The judged pace (s/km) and where it came from, for the log */
  pace: number
  source: SpeedSource
}

/** `gps`: the GPS speed reading, `distance`: distance over time */
export type SpeedSource = 'gps' | 'distance'

export function initPaceCoachState(position: number): PaceCoachState {
  return {
    position,
    samples: [],
    off: null,
    onPaceSinceMs: null,
    lastCorrection: null,
    owesOnPace: false,
  }
}

/**
 * After a pause (manual or auto, #154): the window starts again from these totals. Run time is
 * frozen while paused, so without this the window right after a resume would still hold the
 * slowdown before the stop and call "Faster" at once. Timers between corrections are kept.
 */
export function restartWindow(state: PaceCoachState, totals: StepTotals): PaceCoachState {
  const start = { elapsedMs: totals.elapsedMs, distanceM: totals.distanceM }
  return { ...state, samples: [start], off: null, onPaceSinceMs: null }
}

/**
 * The slow end for a step without its own pace (s/km): `run` for run steps (#103), `walk` for
 * walk steps (#153), or null when walk steps get none
 */
export interface PaceFloors {
  run: number
  walk: number | null
}

/**
 * What the step is coached against: its own pace range, or without one only a slow end, the
 * floor for its kind. Run and walk steps only; warm-up, recovery and cool-down are never coached.
 */
export function paceTarget(
  step: Pick<RunStep, 'kind' | 'paceMin' | 'paceMax'>,
  floors: PaceFloors,
): PaceTarget | null {
  if (step.kind !== 'run' && step.kind !== 'walk') return null
  if (step.paceMin === null && step.paceMax === null) {
    const slow = step.kind === 'run' ? floors.run : floors.walk
    return slow === null ? null : { fast: null, slow }
  }
  // A single pace is both ends of its range
  return { fast: step.paceMin ?? step.paceMax, slow: step.paceMax ?? step.paceMin }
}

/** The first sample holding the same distance as sample `i`: when that distance came in */
function arrival(samples: readonly Sample[], i: number): number {
  while (i > 0 && samples[i - 1]!.distanceM === samples[i]!.distanceM) i--
  return i
}

/**
 * Add the latest totals. A jump faster than any runner (distance arriving at once after a GPS
 * gap) restarts the window, so it never reads as a sprint.
 */
export function addSample(samples: readonly Sample[], next: Sample, windowS: number): Sample[] {
  const last = samples[samples.length - 1]
  if (last && next.elapsedMs <= last.elapsedMs) {
    // Same moment (a fix between timer ticks): keep the newest distance and speed reading
    const speedMps = next.speedMps ?? last.speedMps
    return [
      ...samples.slice(0, -1),
      {
        elapsedMs: last.elapsedMs,
        distanceM: next.distanceM,
        ...(speedMps !== undefined && { speedMps }),
      },
    ]
  }
  if (last) {
    // Measured from when the last distance came in, not from the last tick: a fix just after a
    // tick is a few metres in a fraction of a second, which is no jump
    const from = samples[arrival(samples, samples.length - 1)]!
    const speed = (next.distanceM - from.distanceM) / ((next.elapsedMs - from.elapsedMs) / 1000)
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

/**
 * Speed in m/s over about `seconds`, measured between the moments the distance grew rather
 * than up to the latest tick. Distance comes in jumps of 5 m or more while the timer ticks every
 * second, so measured up to the tick a steady pace swings by a minute per km from one second to
 * the next. Null until the samples cover all of it. A stop is not seen here: `windowSpeed` over
 * the last few seconds catches that.
 */
export function fixSpeed(samples: readonly Sample[], seconds: number): number | null {
  if (samples.length === 0) return null
  const end = arrival(samples, samples.length - 1)
  const cutoff = samples[end]!.elapsedMs - seconds * 1000
  let from = -1
  for (let i = end; i >= 0 && from < 0; i--) if (samples[i]!.elapsedMs <= cutoff) from = i
  if (from < 0) return null
  from = arrival(samples, from)
  const a = samples[from]!
  const b = samples[end]!
  return (b.distanceM - a.distanceM) / ((b.elapsedMs - a.elapsedMs) / 1000)
}

/**
 * The mean GPS speed reading (m/s) over the last `seconds` (#153), or null until the samples
 * cover all of it or with fewer readings than `minPerS` per second. Unlike distance, which grows
 * in jumps of 5 m or more, the reading does not swing at walking speed: there 15 s holds only 3
 * or 4 jumps, and one more or less moves the pace by about 4 min/km.
 */
export function gpsSpeed(
  samples: readonly Sample[],
  seconds: number,
  minPerS: number,
): number | null {
  const last = samples[samples.length - 1]
  if (!last) return null
  const cutoff = last.elapsedMs - seconds * 1000
  if (samples[0]!.elapsedMs > cutoff) return null
  const readings = samples
    .filter((s) => s.elapsedMs > cutoff && s.speedMps !== undefined)
    .map((s) => s.speedMps!)
  if (readings.length === 0 || readings.length < seconds * minPerS) return null
  return readings.reduce((sum, v) => sum + v, 0) / readings.length
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

const cue = (key: PacePhrase, pace: number, source: SpeedSource): PaceCue => ({
  key,
  text: PACE_PHRASES[key],
  pace,
  source,
})

/** The line for a correction: walk steps say "Walk faster" / "Walk slower" (#153) */
function correctionPhrase(step: Pick<RunStep, 'kind'>, key: Correction): PacePhrase {
  if (step.kind !== 'walk') return key
  return key === 'faster' ? 'walkFaster' : 'walkSlower'
}

/**
 * Feed the latest totals of the open step; returns the next state, and the line to say now or
 * null. `speaking` holds a due line back until other speech is over, without losing its timers.
 */
export function nextPaceCue(
  prev: PaceCoachState | null,
  step: RunStep,
  totals: PaceInput,
  floors: PaceFloors,
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
  // Twice the window kept: `fixSpeed` measures from when the distance came in, which can lie
  // a few seconds before the window
  const state: PaceCoachState = {
    ...base,
    samples: addSample(base.samples, totals, config.windowS * 2),
  }
  const none = { state, cue: null }

  const target = paceTarget(step, floors)
  if (!target) return none
  // Walk steps go by the GPS speed reading where there is enough of it (#153); run steps, and
  // walks without readings, by distance over time
  const perS = config.minReadingsPerS
  const gps =
    step.kind === 'walk'
      ? {
          speed: gpsSpeed(state.samples, config.windowS, perS),
          recent: gpsSpeed(state.samples, config.recentS, perS),
        }
      : null
  const source: SpeedSource = gps?.speed != null && gps.recent != null ? 'gps' : 'distance'
  const speed = source === 'gps' ? gps!.speed : fixSpeed(state.samples, config.windowS)
  const recent = source === 'gps' ? gps!.recent : windowSpeed(state.samples, config.recentS)
  if (speed === null || recent === null) {
    return { state: { ...state, off: null, onPaceSinceMs: null }, cue: null }
  }
  // Standing at a crossing, or slowing down for one (under 1 m/s, 16:40 /km, is not walking
  // pace any more): no corrections, and the wait starts over
  if (speed < MIN_MOVING_SPEED_MPS || recent < config.stoppedMps) {
    return { state: { ...state, off: null, onPaceSinceMs: null }, cue: null }
  }

  const pace = 1000 / speed
  const m = config.marginSecPerKm
  const tooFast = target.fast !== null && pace < target.fast - m
  const tooSlow = target.slow !== null && pace > target.slow + m
  const quiet = speaking || nearStepEnd(step, totals)

  if (tooFast || tooSlow) {
    const key: Correction = tooSlow ? 'faster' : 'slower'
    const off = state.off?.key === key ? state.off : { key, sinceMs: now }
    const next = { ...state, off, onPaceSinceMs: null }
    if (now - off.sinceMs < config.sustainS * 1000 || quiet) return { state: next, cue: null }
    const last = state.lastCorrection
    const wait = last?.key === key ? config.reminderS : config.cooldownS
    if (last && now - last.atMs < wait * 1000) return { state: next, cue: null }
    return {
      state: { ...next, lastCorrection: { key, atMs: now }, owesOnPace: true },
      cue: cue(correctionPhrase(step, key), pace, source),
    }
  }

  // Within the margin counts as back on pace: it takes a while to settle into the range, and
  // this is not far enough off for a correction either
  if (!state.owesOnPace) return { state: { ...state, off: null, onPaceSinceMs: null }, cue: null }
  const onPaceSinceMs = state.onPaceSinceMs ?? now
  const next = { ...state, off: null, onPaceSinceMs }
  if (now - onPaceSinceMs < config.backOnPaceS * 1000 || quiet) return { state: next, cue: null }
  return {
    state: { ...next, owesOnPace: false, onPaceSinceMs: null },
    cue: cue('onPace', pace, source),
  }
}
