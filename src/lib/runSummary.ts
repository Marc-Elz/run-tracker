import { distanceMeters, type TrackPoint } from '@/lib/geo'
import type { RunRecord, StoredPoint } from '@/lib/db/runRepository'
import { acceptedPoints, MIN_PACE_DISTANCE_M, paceSecPerKm, summarizeTrack } from '@/lib/runStats'

export type LngLat = [lng: number, lat: number]

export interface RunSummary {
  distanceM: number
  elapsedMs: number
  movingMs: number
  /** Seconds per km over the elapsed time, null when the run is too short for a pace */
  avgPaceSecPerKm: number | null
  /** The drawn route: the used points of each segment, so a pause gap is never joined */
  lines: LngLat[][]
  start: LngLat | null
  end: LngLat | null
  /** [west, south, east, north] of the route, null without points */
  bounds: [number, number, number, number] | null
}

export interface Split {
  /** 1 for the first km; the last, partial split keeps the number of the km it is part of */
  km: number
  distanceM: number
  durationMs: number
  /** Seconds per km */
  paceSecPerKm: number | null
  /** True for the leftover distance after the last full km */
  partial: boolean
}

const KM = 1000

/**
 * Per-km splits from the raw segments. Uses the same used points as the run totals, so the splits
 * add up to the headline distance, and a pause gap (a new segment) adds neither distance nor time.
 * A split boundary inside a step is placed by linear interpolation between its two points.
 */
export function buildSplits(segments: TrackPoint[][]): Split[] {
  const splits: Split[] = []
  let splitDistance = 0
  let splitTime = 0
  const close = (distanceM: number, durationMs: number, partial: boolean) => {
    splits.push({
      km: splits.length + 1,
      distanceM,
      durationMs,
      paceSecPerKm: paceSecPerKm(durationMs, distanceM, partial ? MIN_PACE_DISTANCE_M : 0),
      partial,
    })
  }

  for (const segment of segments) {
    const used = acceptedPoints(segment)
    for (let i = 1; i < used.length; i++) {
      let meters = distanceMeters(used[i - 1]!, used[i]!)
      let ms = used[i]!.timestamp - used[i - 1]!.timestamp
      // A long step can cross more than one boundary
      while (splitDistance + meters >= KM) {
        const part = KM - splitDistance
        const partMs = ms * (part / meters)
        close(KM, splitTime + partMs, false)
        meters -= part
        ms -= partMs
        splitDistance = 0
        splitTime = 0
      }
      splitDistance += meters
      splitTime += ms
    }
  }

  if (splitDistance >= MIN_PACE_DISTANCE_M) close(splitDistance, splitTime, true)
  return splits
}

/** Saved points back into segments; `segment` is the last index opened, so empty segments survive */
export function toSegments(points: StoredPoint[], segment: number): TrackPoint[][] {
  const segments: TrackPoint[][] = Array.from({ length: segment + 1 }, () => [])
  for (const { segment: index, ...point } of points) {
    while (segments.length <= index) segments.push([])
    segments[index]!.push(point)
  }
  return segments
}

/** Everything the summary screen shows, from a saved run and its raw points. */
export function buildRunSummary(run: RunRecord, points: StoredPoint[]): RunSummary {
  const segments = toSegments(points, run.segment)
  // Totals come from the raw points, as in recovery; the stored ones are only a cache
  const totals = points.length > 0 ? summarizeTrack(segments) : run
  const lines = segments
    .map((segment) => acceptedPoints(segment).map((p): LngLat => [p.lon, p.lat]))
    .filter((line) => line.length > 0)

  const all = lines.flat()
  let bounds: RunSummary['bounds'] = null
  for (const [lng, lat] of all) {
    bounds = bounds
      ? [
          Math.min(bounds[0], lng),
          Math.min(bounds[1], lat),
          Math.max(bounds[2], lng),
          Math.max(bounds[3], lat),
        ]
      : [lng, lat, lng, lat]
  }

  return {
    distanceM: totals.distanceM,
    elapsedMs: run.elapsedMs,
    movingMs: totals.movingMs,
    avgPaceSecPerKm: paceSecPerKm(run.elapsedMs, totals.distanceM),
    lines,
    start: all[0] ?? null,
    end: all[all.length - 1] ?? null,
    bounds,
  }
}
