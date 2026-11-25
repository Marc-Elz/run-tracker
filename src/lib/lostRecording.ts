/**
 * Recording that stopped early because the app was killed (#81). Pure functions, no Vue.
 */

import type { TrackPoint } from './geo'
import type { RunRecord } from './db/runRepository'
import type { RunPause } from './runPauses'
import { isAccurate } from './runStats'

/**
 * When a run the app was killed in stopped recording, or null when it lost nothing.
 *
 * Only a run that was recording loses data: stored as running, or auto-paused (the runner may
 * have moved on, and those fixes were held back, never stored). A manual pause records nothing
 * anyway. Recording stopped at the last stored fix, or where the open auto-pause began when that
 * is later; with neither, where the open segment (or the run) started. Pass the pauses as stored,
 * before recovery closes the open one.
 */
export function lostRecordingAt(
  run: Pick<RunRecord, 'status' | 'startedAt' | 'segmentStartedAt'>,
  pauses: readonly RunPause[],
  segments: readonly TrackPoint[][],
): number | null {
  const openAuto = pauses.filter((p) => p.kind === 'auto' && p.endedAt === null)
  if (run.status !== 'running' && openAuto.length === 0) return null
  const fixes = segments.flat()
  const candidates = [
    ...openAuto.map((p) => p.startedAt),
    ...(fixes.length > 0 ? [fixes[fixes.length - 1]!.timestamp] : []),
  ]
  if (candidates.length > 0) return Math.max(...candidates)
  return run.segmentStartedAt ?? run.startedAt
}

export interface RecordingGap {
  /** When recording stopped */
  from: number
  /** The first fix after it (the run was resumed), or null when recording never came back */
  to: number | null
  /** [lon, lat] of the last fix before the gap, for the map; null without one */
  spot: [number, number] | null
}

/** The gap left by `lostAt` in a saved run's fixes; null when nothing was lost */
export function recordingGap(
  lostAt: number | null,
  segments: readonly TrackPoint[][],
): RecordingGap | null {
  if (lostAt === null) return null
  const fixes = segments.flat()
  const after = fixes.find((p) => p.timestamp > lostAt)
  const before = fixes.filter((p) => p.timestamp <= lostAt)
  // The drawn route uses accurate fixes only, so prefer one of those for the dot
  let last: TrackPoint | undefined
  for (let i = before.length - 1; i >= 0 && !last; i--) if (isAccurate(before[i]!)) last = before[i]
  last ??= before[before.length - 1]
  return {
    from: lostAt,
    to: after?.timestamp ?? null,
    spot: last ? [last.lon, last.lat] : null,
  }
}
