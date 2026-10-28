import { paceSecPerKm } from '@/lib/runStats'

export type CueDistanceKm = 0 | 1 | 2 | 5
export type CueTimeMin = 0 | 5 | 10

/** 0 turns that trigger off */
export interface CueConfig {
  distanceKm: CueDistanceKm
  timeMin: CueTimeMin
}

export const CUE_DISTANCE_OPTIONS: readonly CueDistanceKm[] = [0, 1, 2, 5]
export const CUE_TIME_OPTIONS: readonly CueTimeMin[] = [0, 5, 10]
export const DEFAULT_CUE_CONFIG: CueConfig = { distanceKm: 1, timeMin: 0 }

/** Below this the pace of an interval is too noisy to speak */
const MIN_PACE_DISTANCE_M = 50

/** Where the next cues are due, and where the last one was (for the pace since then) */
export interface CueState {
  nextDistanceM: number | null
  nextElapsedMs: number | null
  lastDistanceM: number
  lastElapsedMs: number
}

/** First threshold above `value` on a grid of `step` */
function nextThreshold(value: number, step: number): number {
  return (Math.floor(value / step) + 1) * step
}

function thresholds(distanceM: number, elapsedMs: number, config: CueConfig) {
  return {
    nextDistanceM: config.distanceKm > 0 ? nextThreshold(distanceM, config.distanceKm * 1000) : null,
    nextElapsedMs: config.timeMin > 0 ? nextThreshold(elapsedMs, config.timeMin * 60_000) : null,
  }
}

/** State for a run at these totals: the next cue is the next threshold, never one already passed. */
export function initCueState(distanceM: number, elapsedMs: number, config: CueConfig): CueState {
  return { ...thresholds(distanceM, elapsedMs, config), lastDistanceM: distanceM, lastElapsedMs: elapsedMs }
}

/** New config mid-run: new thresholds from the current totals, the pace baseline stays. */
export function retargetCueState(
  state: CueState,
  distanceM: number,
  elapsedMs: number,
  config: CueConfig,
): CueState {
  return { ...state, ...thresholds(distanceM, elapsedMs, config) }
}

/**
 * The cue due at these totals, with the state after it, or null. Several thresholds crossed at
 * once (a GPS jump, distance and time together) give one cue, then the thresholds move past the
 * current totals.
 */
export function nextCue(
  state: CueState,
  distanceM: number,
  elapsedMs: number,
  config: CueConfig,
): { text: string; state: CueState } | null {
  const distanceDue = state.nextDistanceM !== null && distanceM >= state.nextDistanceM
  const timeDue = state.nextElapsedMs !== null && elapsedMs >= state.nextElapsedMs
  if (!distanceDue && !timeDue) return null
  const intervalM = distanceM - state.lastDistanceM
  const intervalMs = elapsedMs - state.lastElapsedMs
  const pace = intervalM >= MIN_PACE_DISTANCE_M ? paceSecPerKm(intervalMs, intervalM) : null
  return {
    text: cueText(distanceM, elapsedMs, pace),
    state: initCueState(distanceM, elapsedMs, config),
  }
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`

/** 1000 -> "1 kilometre", 1503 -> "1.5 kilometres", 1371 -> "1.37 kilometres" (cut, not rounded: a cue fired just past 2 km says "2") */
function spokenDistance(meters: number): string {
  const km = Math.floor(meters / 10) / 100
  return `${km} ${km === 1 ? 'kilometre' : 'kilometres'}`
}

/** 332000 -> "5 minutes 32 seconds", 3725000 -> "1 hour 2 minutes 5 seconds" */
function spokenDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const parts = []
  if (h > 0) parts.push(plural(h, 'hour'))
  if (m > 0) parts.push(plural(m, 'minute'))
  if (s > 0 || parts.length === 0) parts.push(plural(s, 'second'))
  return parts.join(' ')
}

/** What is spoken: distance, time and (when known) pace, in metric units. */
export function cueText(distanceM: number, elapsedMs: number, paceSecPerKmValue: number | null): string {
  const parts = [spokenDistance(distanceM), spokenDuration(Math.floor(elapsedMs / 1000))]
  // Slower than 60 min/km is standing around, not a pace
  if (paceSecPerKmValue !== null && paceSecPerKmValue > 0 && paceSecPerKmValue < 3600) {
    parts.push(`pace ${spokenDuration(Math.round(paceSecPerKmValue))} per kilometre`)
  }
  return parts.join(', ')
}
