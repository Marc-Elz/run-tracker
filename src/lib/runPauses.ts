/**
 * The pauses of a run as stored (#154). Only auto-pauses are written for now; `kind` leaves
 * room for manual pauses without a table rebuild. Pure functions, no Vue.
 */

import type { TrackPoint } from './geo'

export const PAUSE_KINDS = ['auto', 'manual'] as const
export type PauseKind = (typeof PAUSE_KINDS)[number]

export interface RunPause {
  /** Order within the run, from 0 */
  position: number
  kind: PauseKind
  /** Phone clock, ms: when the run paused */
  startedAt: number
  /** Phone clock, ms: when the run moved on or was stopped; null while the pause is open */
  endedAt: number | null
  /** Run time (elapsed, without pauses) at the pause, so it can be placed on the run's timeline */
  startedElapsedMs: number
  /** Where the run stopped: its last accepted fix, null when it had none */
  lat: number | null
  lon: number | null
}

/** The pause closed at `t`, never before it started */
export function closePause(pause: RunPause, t: number): RunPause {
  return { ...pause, endedAt: Math.max(pause.startedAt, t) }
}

/** The position for a run's next pause: after the highest stored, so no row is overwritten */
export function nextPausePosition(pauses: readonly RunPause[]): number {
  return pauses.reduce((next, p) => Math.max(next, p.position + 1), 0)
}

/**
 * Where a pause left open by a killed app ends: where the run moved on, the first fix of the
 * first later segment (an auto-resume starts its segment at the first moving fix, never before
 * the pause), or the last stored fix when the run never moved on. The fixes held back while
 * auto-paused were never stored, so a later end is unknown.
 */
export function killedPauseEnd(pause: RunPause, segments: readonly TrackPoint[][]): number {
  const next = segments.slice(1).find((seg) => (seg[0]?.timestamp ?? -Infinity) >= pause.startedAt)
  const fixes = segments.flat()
  return next?.[0]?.timestamp ?? fixes[fixes.length - 1]?.timestamp ?? pause.startedAt
}

export interface PauseRow {
  position: number
  startedAt: number
  durationMs: number
  /** [lon, lat] for the map, null without a spot */
  spot: [number, number] | null
}

/**
 * The auto-pauses of a finished run for its summary: each with its start, length and spot, and
 * their total. A pause left open (it cannot be, once the run is finished) counts as zero long.
 */
export function pauseList(pauses: readonly RunPause[]): { rows: PauseRow[]; totalMs: number } {
  const rows = pauses
    .filter((p) => p.kind === 'auto')
    .sort((a, b) => a.position - b.position)
    .map((p) => ({
      position: p.position,
      startedAt: p.startedAt,
      durationMs: p.endedAt === null ? 0 : Math.max(0, p.endedAt - p.startedAt),
      spot: p.lat === null || p.lon === null ? null : ([p.lon, p.lat] as [number, number]),
    }))
  return { rows, totalMs: rows.reduce((sum, r) => sum + r.durationMs, 0) }
}
