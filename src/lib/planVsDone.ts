import { expandSteps } from '@/lib/stepProgress'
import type { SessionStep } from '@/lib/training'

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
