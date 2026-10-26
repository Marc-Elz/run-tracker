import type { TrackPoint } from '@/lib/geo'
import type { RunRecord, StoredPoint } from '@/lib/db/runRepository'
import { acceptedPoints, paceSecPerKm, summarizeTrack } from '@/lib/runStats'

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
