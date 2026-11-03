import type { RunRecord, RunRepository, StoredPoint } from '@/lib/db/runRepository'
import { acceptedPoints } from '@/lib/runStats'
import { toSegments, type LngLat } from '@/lib/runSummary'
import { simplifyLine } from '@/lib/simplifyTrack'

/** Bump when the simplification changes: stored overviews with another value are rebuilt */
export const OVERVIEW_ALGO = 1
/** Simplification tolerance for the all-routes map, in metres */
export const OVERVIEW_TOLERANCE_M = 5
/** Runs built per step; progress is reported between steps so the screen can update */
const BATCH = 10

/** A run's route reduced for the all-routes map; lines are empty when the run has no drawable route */
export interface RouteOverview {
  runId: string
  algo: number
  lines: LngLat[][]
  /** [west, south, east, north], null without lines */
  bounds: [number, number, number, number] | null
}

export function buildOverview(run: RunRecord, points: StoredPoint[]): RouteOverview {
  const lines = toSegments(points, run.segment)
    .map((segment) =>
      simplifyLine(
        acceptedPoints(segment).map((p): LngLat => [p.lon, p.lat]),
        OVERVIEW_TOLERANCE_M,
      ),
    )
    .filter((line) => line.length >= 2)
  let bounds: RouteOverview['bounds'] = null
  for (const [lng, lat] of lines.flat()) {
    bounds = bounds
      ? [
          Math.min(bounds[0], lng),
          Math.min(bounds[1], lat),
          Math.max(bounds[2], lng),
          Math.max(bounds[3], lat),
        ]
      : [lng, lat, lng, lat]
  }
  return { runId: run.id, algo: OVERVIEW_ALGO, lines, bounds }
}

export interface LoadedOverviews {
  /** Finished runs, newest first (as `listFinished`) */
  runs: RunRecord[]
  /** In the order of `runs`; runs that failed to build are missing */
  overviews: RouteOverview[]
  /** Runs whose route could not be built; they are left out and tried again next time */
  failed: number
}

/**
 * Overviews of every finished run. Reads the stored ones and builds the missing or outdated ones
 * from the raw points, saving each, so only the first open after new runs does real work.
 * `onProgress` gets (done, total) of the runs that needed building.
 */
export async function loadRouteOverviews(
  repo: Pick<RunRepository, 'listFinished' | 'loadPoints' | 'readOverviews' | 'saveOverview'>,
  onProgress?: (done: number, total: number) => void,
): Promise<LoadedOverviews> {
  const [runs, stored] = await Promise.all([repo.listFinished(), repo.readOverviews()])
  const byRun = new Map(stored.filter((o) => o.algo === OVERVIEW_ALGO).map((o) => [o.runId, o]))
  const todo = runs.filter((r) => !byRun.has(r.id))
  let failed = 0
  for (let i = 0; i < todo.length; i++) {
    const run = todo[i]!
    try {
      const overview = buildOverview(run, await repo.loadPoints(run.id))
      await repo.saveOverview(overview)
      byRun.set(run.id, overview)
    } catch (err) {
      console.warn('[db] could not build route overview', run.id, err)
      failed++
    }
    if ((i + 1) % BATCH === 0 || i + 1 === todo.length) {
      onProgress?.(i + 1, todo.length)
      // Let the screen paint between batches
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  return { runs, overviews: runs.flatMap((r) => byRun.get(r.id) ?? []), failed }
}
