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
/** This many fixes in a row that are too far from a segment's first fix but agree with each other overrule it (#178) */
export const OVERRULE_FIXES = 3

export interface RunTotals {
  distanceM: number
  movingMs: number
}

/** Why `step` skipped a fix: poor accuracy, not after the anchor in time, jitter, or too fast */
export type RejectReason = 'inaccurate' | 'order' | 'jitter' | 'speed'

export type StepResult =
  { accepted: false; reason: RejectReason } | { accepted: true; meters: number; movingMs: number }

/** The filter state of one running segment, from a start or resume to a pause */
export interface SegmentFilter {
  /** Fixes used for distance and pace, in order; the last one is the anchor */
  accepted: TrackPoint[]
  /** While only the first fix is accepted: the latest fixes rejected as too far from it, all agreeing with each other */
  rejected: TrackPoint[]
}

export function isAccurate(point: TrackPoint): boolean {
  return point.accuracy === undefined || point.accuracy <= MAX_ACCURACY_M
}

/**
 * Decide whether `point` is used, given `anchor`: the last used point of the current
 * running segment (null at the start of a segment). An accepted point becomes the new anchor.
 */
export function step(anchor: TrackPoint | null, point: TrackPoint): StepResult {
  if (!isAccurate(point)) return { accepted: false, reason: 'inaccurate' }
  if (!anchor) return { accepted: true, meters: 0, movingMs: 0 }
  const ms = point.timestamp - anchor.timestamp
  if (ms <= 0) return { accepted: false, reason: 'order' }
  const meters = distanceMeters(anchor, point)
  if (meters < MIN_STEP_M) return { accepted: false, reason: 'jitter' }
  const speed = meters / (ms / 1000)
  if (speed > MAX_SPEED_MPS) return { accepted: false, reason: 'speed' }
  return { accepted: true, meters, movingMs: speed >= MIN_MOVING_SPEED_MPS ? ms : 0 }
}

export function emptySegmentFilter(): SegmentFilter {
  return { accepted: [], rejected: [] }
}

/** Two fixes could both be real: `b` comes later, and is either jitter-close or reachable from `a`. */
function agrees(a: TrackPoint, b: TrackPoint): boolean {
  const ms = b.timestamp - a.timestamp
  if (ms <= 0) return false
  const meters = distanceMeters(a, b)
  return meters < MIN_STEP_M || meters / (ms / 1000) <= MAX_SPEED_MPS
}

/**
 * Feed one fix to a segment's filter, updated in place (copying the lists per fix would make a
 * long run quadratic). The result is accepted when the used fixes changed, with the distance
 * and moving time they added.
 *
 * Each fix goes through `step` against the anchor. One exception (#178): a bad first fix that
 * is accurate enough would otherwise lock out every real fix after it, as they are all too far
 * from it to reach at running speed. So while the segment has only that first fix,
 * `OVERRULE_FIXES` fixes in a row that are rejected for speed but agree with each other drop
 * it, and the segment restarts from the oldest of them. The dropped fix counted no distance,
 * so nothing is taken back.
 */
export function addToSegment(filter: SegmentFilter, point: TrackPoint): StepResult {
  const result = step(filter.accepted[filter.accepted.length - 1] ?? null, point)
  if (result.accepted) {
    filter.accepted.push(point)
    if (filter.rejected.length > 0) filter.rejected = []
    return result
  }
  if (result.reason === 'inaccurate') return result
  if (result.reason !== 'speed' || filter.accepted.length !== 1) {
    // A fix that fits the anchor (or the rule is off): the anchor stands
    if (filter.rejected.length > 0) filter.rejected = []
    return result
  }

  const last = filter.rejected[filter.rejected.length - 1]
  if (last && agrees(last, point)) filter.rejected.push(point)
  else filter.rejected = [point]
  if (filter.rejected.length < OVERRULE_FIXES) return result

  const restart = filter.rejected
  filter.accepted = []
  filter.rejected = []
  let meters = 0
  let movingMs = 0
  for (const p of restart) {
    const r = step(filter.accepted[filter.accepted.length - 1] ?? null, p)
    if (!r.accepted) continue
    filter.accepted.push(p)
    meters += r.meters
    movingMs += r.movingMs
  }
  return { accepted: true, meters, movingMs }
}

/** Distance and moving time of a run; each segment is the raw points between a start/resume and a pause. */
export function summarizeTrack(segments: TrackPoint[][]): RunTotals {
  const totals: RunTotals = { distanceM: 0, movingMs: 0 }
  for (const segment of segments) {
    const filter = emptySegmentFilter()
    for (const point of segment) {
      const result = addToSegment(filter, point)
      if (!result.accepted) continue
      totals.distanceM += result.meters
      totals.movingMs += result.movingMs
    }
  }
  return totals
}

/** The points of one segment that `summarizeTrack` counts, in order. */
export function acceptedPoints(segment: TrackPoint[]): TrackPoint[] {
  const filter = emptySegmentFilter()
  for (const point of segment) addToSegment(filter, point)
  return filter.accepted
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
