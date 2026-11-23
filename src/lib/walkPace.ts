/**
 * The "Slowest walk" pace for walk steps (#153): a value typed in Settings, or one suggested from
 * recent walk steps. Pure functions, no Vue, like `paceCoach.ts`. A step's pace comes from its
 * `run_steps` row, whose time already leaves out pauses and auto-pauses (#154).
 */
import type { RunStep } from './stepProgress'
import type { SessionType } from './training'

/** Starting values, to tune once there are more walks */
export const WALK_SUGGESTION_CONFIG = {
  /** Walks (runs with usable walk steps) the suggestion is taken from, newest first */
  maxRuns: 5,
  /** Walks older than this are left out: walking pace improves over a program */
  maxAgeDays: 42,
  /** Shorter walk steps are left out, since GPS lag at the step start skews them */
  minStepS: 60,
  minStepM: 50,
  /** Less data than this gives no suggestion */
  minRuns: 2,
  minTotalS: 600,
  /** Added to the typical pace, so the floor catches a slide into a stroll, not half the walk */
  marginSecPerKm: 30,
  roundToS: 5,
}

/** A typed walk pace must lie in this range (s/km): 6:00 to 20:00 */
export const WALK_PACE_MIN = 360
export const WALK_PACE_MAX = 1200

/** The "Slowest walk" setting as saved on the phone */
export interface SlowestWalk {
  on: boolean
  /** Typed pace in s/km; null follows the suggestion */
  typed: number | null
  /** Also coach the walk breaks of a run/walk session */
  breaks: boolean
}
export const DEFAULT_SLOWEST_WALK: SlowestWalk = { on: false, typed: null, breaks: false }

/** A finished run's steps, as read from `run_steps` */
export interface RunWithSteps {
  startedAt: number
  steps: RunStep[]
}

/** A suggested pace and what it is based on, or why there is none */
export type WalkSuggestion = { pace: number; runs: number; since: number } | { reason: string }

/** Walks started before this are too old for the suggestion */
export function suggestionSince(now: number, config = WALK_SUGGESTION_CONFIG): number {
  return now - config.maxAgeDays * 86_400_000
}

interface WalkPiece {
  seconds: number
  metres: number
}

/** The walk steps of a run that are long enough to judge a pace by; unfinished ones are skipped */
export function usableWalkSteps(
  steps: readonly RunStep[],
  config = WALK_SUGGESTION_CONFIG,
): WalkPiece[] {
  const out: WalkPiece[] = []
  for (const s of steps) {
    if (s.kind !== 'walk' || s.endedElapsedMs === null || s.endedDistanceM === null) continue
    const seconds = (s.endedElapsedMs - s.startedElapsedMs) / 1000
    const metres = s.endedDistanceM - s.startedDistanceM
    if (seconds >= config.minStepS && metres >= config.minStepM) out.push({ seconds, metres })
  }
  return out
}

/**
 * The suggested walk floor from finished runs, newest first: the distance-weighted median pace
 * of their usable walk steps plus a margin, rounded. Walk sessions and run/walk breaks both count.
 */
export function suggestWalkFloor(
  runs: readonly RunWithSteps[],
  now: number,
  config = WALK_SUGGESTION_CONFIG,
): WalkSuggestion {
  const oldest = suggestionSince(now, config)
  const used: { startedAt: number; pieces: WalkPiece[] }[] = []
  for (const run of runs) {
    if (used.length >= config.maxRuns) break
    if (run.startedAt < oldest) continue
    const pieces = usableWalkSteps(run.steps, config)
    if (pieces.length > 0) used.push({ startedAt: run.startedAt, pieces })
  }
  const pieces = used.flatMap((r) => r.pieces)
  const totalS = pieces.reduce((sum, p) => sum + p.seconds, 0)
  if (used.length < config.minRuns || totalS < config.minTotalS) {
    const walks = used.length === 1 ? '1 walk' : `${used.length} walks`
    return {
      reason:
        `needs ${config.minRuns} walks with ${config.minTotalS / 60} min of walk steps ` +
        `(so far ${walks}, ${Math.floor(totalS / 60)} min)`,
    }
  }
  const typical = weightedMedianPace(pieces)
  const pace = Math.round((typical + config.marginSecPerKm) / config.roundToS) * config.roundToS
  return { pace, runs: used.length, since: Math.min(...used.map((r) => r.startedAt)) }
}

/** Pace (s/km) that half the distance was walked faster than */
function weightedMedianPace(pieces: readonly WalkPiece[]): number {
  const sorted = pieces
    .map((p) => ({ pace: p.seconds / (p.metres / 1000), metres: p.metres }))
    .sort((a, b) => a.pace - b.pace)
  const half = sorted.reduce((sum, p) => sum + p.metres, 0) / 2
  let walked = 0
  for (const p of sorted) {
    walked += p.metres
    if (walked >= half) return p.pace
  }
  return sorted[sorted.length - 1]!.pace
}

/**
 * A typed value wins over a suggested one until cleared. A suggestion that differs from the typed
 * value is offered (`newerSuggestion`), never applied. Generic, so the 5K pace (#142) can use it.
 */
export function typedOrSuggested(
  typed: number | null,
  suggested: number | null,
): { value: number | null; newerSuggestion: number | null } {
  return {
    value: typed ?? suggested,
    newerSuggestion: typed !== null && suggested !== null && suggested !== typed ? suggested : null,
  }
}

/** The walk floor the setting gives, null when off or with neither a typed nor a suggested pace */
export function effectiveWalkFloor(
  setting: Pick<SlowestWalk, 'on' | 'typed'>,
  suggestion: WalkSuggestion | null,
): { floor: number | null; newerSuggestion: number | null } {
  const suggested = suggestion && 'pace' in suggestion ? suggestion.pace : null
  const { value, newerSuggestion } = typedOrSuggested(setting.typed, suggested)
  return { floor: setting.on ? value : null, newerSuggestion }
}

/**
 * The floor for walk steps without a pace in this session: a walk session always, the walk
 * breaks of a run/walk session only when asked for, since breaks are recovery
 */
export function walkFloorFor(
  type: SessionType | null,
  floor: number | null,
  breaks: boolean,
): number | null {
  if (type === 'walk' || (type === 'runwalk' && breaks)) return floor
  return null
}
