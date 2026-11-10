import { expandSteps } from '@/lib/stepProgress'
import type { ProgramSession, SessionStep } from '@/lib/training'

/** What a session's steps add up to; a total is null when the steps don't define it (#102) */
export interface PlannedTotals {
  /** Planned seconds, when every step has a time target */
  seconds: number | null
  /** Planned metres, when every step has a distance target */
  metres: number | null
}

/** One line of "planned vs. done" in the run summary */
export interface PlanComparison {
  kind: 'time' | 'distance'
  /** Seconds or metres */
  planned: number
  /** Seconds or metres, in the same unit as `planned` */
  done: number
}

/**
 * The planned time and distance of a session. A repeat counts once per round. A total exists only
 * when every step has a target of that kind: with a step that has no target, or with a mix of time
 * and distance targets, the total would be a guess, so it is null.
 */
export function plannedTotals(steps: SessionStep[]): PlannedTotals {
  const timeline = expandSteps(steps)
  const total = (kind: 'duration' | 'distance'): number | null => {
    if (timeline.length === 0) return null
    let sum = 0
    for (const step of timeline) {
      if (step.targetKind !== kind || step.targetValue === null) return null
      sum += step.targetValue
    }
    return sum
  }
  return { seconds: total('duration'), metres: total('distance') }
}

/** The lines to show for a run against its plan: none when the plan has no total */
export function compareToPlan(
  planned: PlannedTotals,
  run: { elapsedMs: number; distanceM: number },
): PlanComparison[] {
  const lines: PlanComparison[] = []
  if (planned.seconds !== null) {
    lines.push({ kind: 'time', planned: planned.seconds, done: Math.round(run.elapsedMs / 1000) })
  }
  if (planned.metres !== null) {
    lines.push({ kind: 'distance', planned: planned.metres, done: run.distanceM })
  }
  return lines
}

/** A week of a program against its runs (#102) */
export interface WeekSummary {
  /** Sessions that can be run: every session but the rest days */
  sessions: number
  /** Sessions with a finished run */
  done: number
  /** Skipped sessions that have no finished run */
  skipped: number
  /** Planned seconds of the sessions still counted, or null when any of them has no time total */
  plannedSeconds: number | null
  doneSeconds: number
  /** Planned metres, or null when any counted session has no distance total */
  plannedMetres: number | null
  doneMetres: number
}

/**
 * How a week went. Skipped sessions that were never run drop out of the planned amounts, since
 * they are no longer going to happen. Done time and distance add up every finished run linked to
 * the week's sessions, so a redo counts as training too.
 */
export function weekSummary(
  weekSessions: readonly ProgramSession[],
  planned: ReadonlyMap<string, PlannedTotals>,
  runs: readonly { sessionId: string | null; elapsedMs: number; distanceM: number }[],
  skipped: ReadonlySet<string>,
): WeekSummary {
  const runnable = weekSessions.filter((s) => s.type !== 'rest')
  const ids = new Set(runnable.map((s) => s.id))
  const own = runs.filter((r) => r.sessionId !== null && ids.has(r.sessionId))
  const doneIds = new Set(own.map((r) => r.sessionId))
  const counted = runnable.filter((s) => doneIds.has(s.id) || !skipped.has(s.id))
  const total = (pick: (t: PlannedTotals) => number | null): number | null => {
    let sum = 0
    for (const s of counted) {
      const value = pick(planned.get(s.id) ?? { seconds: null, metres: null })
      if (value === null) return null
      sum += value
    }
    return counted.length === 0 ? null : sum
  }
  return {
    sessions: runnable.length,
    done: doneIds.size,
    skipped: runnable.filter((s) => skipped.has(s.id) && !doneIds.has(s.id)).length,
    plannedSeconds: total((t) => t.seconds),
    doneSeconds: Math.round(own.reduce((n, r) => n + r.elapsedMs, 0) / 1000),
    plannedMetres: total((t) => t.metres),
    doneMetres: own.reduce((n, r) => n + r.distanceM, 0),
  }
}
