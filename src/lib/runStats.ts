import { distanceMeters, type TrackPoint } from '@/lib/geo'

/** Fixes with a worse horizontal accuracy than this are stored but not used for distance or pace */
export const MAX_ACCURACY_M = 25
/** A step faster than this (30 km/h) is a GPS jump, not running */
export const MAX_SPEED_MPS = 30 / 3.6
/** A fix closer than this to the last used one is jitter; it is skipped and the anchor stays put */
export const MIN_STEP_M = 5
/** A step slower than this (16:40 min/km) counts as standing still, not as moving time */
export const MIN_MOVING_SPEED_MPS = 1
/** Below this distance a pace is meaningless (GPS jitter while standing still) */
export const MIN_PACE_DISTANCE_M = 10

export interface RunTotals {
  distanceM: number
  movingMs: number
}

export type StepResult =
  | { accepted: false }
  | { accepted: true; meters: number; movingMs: number }

export function isAccurate(point: TrackPoint): boolean {
  return point.accuracy === undefined || point.accuracy <= MAX_ACCURACY_M
}

/**
 * Decide whether `point` is used, given `anchor`: the last used point of the current
 * running segment (null at the start of a segment). An accepted point becomes the new anchor.
 */
export function step(anchor: TrackPoint | null, point: TrackPoint): StepResult {
  if (!isAccurate(point)) return { accepted: false }
  if (!anchor) return { accepted: true, meters: 0, movingMs: 0 }
  const ms = point.timestamp - anchor.timestamp
  if (ms <= 0) return { accepted: false }
  const meters = distanceMeters(anchor, point)
  if (meters < MIN_STEP_M) return { accepted: false }
  const speed = meters / (ms / 1000)
  if (speed > MAX_SPEED_MPS) return { accepted: false }
  return { accepted: true, meters, movingMs: speed >= MIN_MOVING_SPEED_MPS ? ms : 0 }
}

/** Distance and moving time of a run; each segment is the raw points between a start/resume and a pause. */
export function summarizeTrack(segments: TrackPoint[][]): RunTotals {
  const totals: RunTotals = { distanceM: 0, movingMs: 0 }
  for (const segment of segments) {
    let anchor: TrackPoint | null = null
    for (const point of segment) {
      const result = step(anchor, point)
      if (!result.accepted) continue
      totals.distanceM += result.meters
      totals.movingMs += result.movingMs
      anchor = point
    }
  }
  return totals
}

/** The points of one segment that `summarizeTrack` counts, in order. */
export function acceptedPoints(segment: TrackPoint[]): TrackPoint[] {
  const used: TrackPoint[] = []
  let anchor: TrackPoint | null = null
  for (const point of segment) {
    if (!step(anchor, point).accepted) continue
    used.push(point)
    anchor = point
  }
  return used
}

/** Seconds per km, or null when the distance is too short to mean anything. */
export function paceSecPerKm(
  ms: number,
  meters: number,
  minMeters: number = MIN_PACE_DISTANCE_M,
): number | null {
  if (meters < minMeters || ms <= 0) return null
  return ms / 1000 / (meters / 1000)
}

/** Pace over the used points of one segment that fall at or after `since`. */
export function windowPaceSecPerKm(
  accepted: TrackPoint[],
  since: number,
  minMeters: number,
): number | null {
  const recent = accepted.filter((p) => p.timestamp >= since)
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (!first || !last || first === last) return null
  let meters = 0
  for (let i = 1; i < recent.length; i++) meters += distanceMeters(recent[i - 1]!, recent[i]!)
  return paceSecPerKm(last.timestamp - first.timestamp, meters, minMeters)
}
