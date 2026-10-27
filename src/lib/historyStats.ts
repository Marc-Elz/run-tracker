import { paceSecPerKm } from '@/lib/runStats'
import type { RunRecord } from '@/lib/db/runRepository'

/** Below this distance a run is too short to count as the best pace (GPS blips) */
export const MIN_BEST_PACE_DISTANCE_M = 1000

export interface PeriodTotals {
  count: number
  distanceM: number
  elapsedMs: number
}

export interface HistoryStats {
  week: PeriodTotals
  month: PeriodTotals
  all: PeriodTotals
  /** Greatest distance of a single run, 0 when there are no runs */
  longestM: number
  /** Fastest pace of a run of at least 1 km, or null when there is none */
  bestPaceSecPerKm: number | null
}

/** Midnight at the start of the Monday of `now`'s week, in the phone's time zone. */
export function startOfWeek(now: number): number {
  const d = new Date(now)
  const sinceMonday = (d.getDay() + 6) % 7
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - sinceMonday).getTime()
}

/** Midnight at the start of the calendar month of `now`, in the phone's time zone. */
export function startOfMonth(now: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

const empty = (): PeriodTotals => ({ count: 0, distanceM: 0, elapsedMs: 0 })

function add(totals: PeriodTotals, run: RunRecord) {
  totals.count += 1
  totals.distanceM += run.distanceM
  totals.elapsedMs += run.elapsedMs
}

/** Totals per period plus records; runs are bucketed by their start time. */
export function summarizeRuns(runs: RunRecord[], now: number): HistoryStats {
  const weekStart = startOfWeek(now)
  const monthStart = startOfMonth(now)
  const stats: HistoryStats = {
    week: empty(),
    month: empty(),
    all: empty(),
    longestM: 0,
    bestPaceSecPerKm: null,
  }
  for (const run of runs) {
    add(stats.all, run)
    if (run.startedAt >= monthStart) add(stats.month, run)
    if (run.startedAt >= weekStart) add(stats.week, run)
    stats.longestM = Math.max(stats.longestM, run.distanceM)
    if (run.distanceM < MIN_BEST_PACE_DISTANCE_M) continue
    const pace = paceSecPerKm(run.elapsedMs, run.distanceM)
    if (pace !== null && (stats.bestPaceSecPerKm === null || pace < stats.bestPaceSecPerKm)) {
      stats.bestPaceSecPerKm = pace
    }
  }
  return stats
}
