import { expandSteps, type RunStep, type TimelineStep } from '@/lib/stepProgress'
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

/**
 * How far a run step may miss its target before it counts against the plan (#134): more than 20%
 * short of its time or distance, or more than 20% slower than its slowest allowed pace.
 */
export const OFF_PLAN_TOLERANCE = 0.2
/** A run step without a pace target counts as walked when it is slower than this (10:00 min/km) */
export const WALKING_PACE_S_PER_KM = 600
/** The share of the planned run-step time that may go wrong before the whole run is off plan */
export const OFF_PLAN_SHARE = 0.5

/** How the run steps of one run went against the plan (#134) */
export interface RunStepVerdict {
  /** Run steps in the plan */
  runSteps: number
  /** Run steps that were too slow, cut short, or never reached */
  offSteps: number
  /** More than {@link OFF_PLAN_SHARE} of the planned run-step time went wrong */
  offPlan: boolean
}

/** Seconds a run step is planned to take: its time, or its distance at its slowest allowed pace */
function plannedSeconds(step: TimelineStep, recorded: RunStep | null): number {
  if (step.targetValue === null || step.targetKind === 'none') {
    // An open step ends by hand: it weighs what it took, and nothing when it was never reached
    return recorded?.endedElapsedMs != null
      ? (recorded.endedElapsedMs - recorded.startedElapsedMs) / 1000
      : 0
  }
  if (step.targetKind === 'duration') return step.targetValue
  return (step.targetValue / 1000) * (step.paceMax ?? WALKING_PACE_S_PER_KM)
}

/** Whether a recorded run step went wrong: cut short, or slower than allowed */
function stepIsOff(step: RunStep): boolean {
  if (step.endedElapsedMs === null || step.endedDistanceM === null) return true
  const seconds = (step.endedElapsedMs - step.startedElapsedMs) / 1000
  const metres = step.endedDistanceM - step.startedDistanceM
  const short = 1 - OFF_PLAN_TOLERANCE
  if (step.targetValue !== null) {
    if (step.targetKind === 'duration' && seconds < step.targetValue * short) return true
    if (step.targetKind === 'distance' && metres < step.targetValue * short) return true
  }
  if (metres <= 0) return seconds > 0
  const pace = seconds / (metres / 1000)
  const limit =
    step.paceMax !== null ? step.paceMax * (1 + OFF_PLAN_TOLERANCE) : WALKING_PACE_S_PER_KM
  return pace > limit
}

/**
 * How a run went against its session's run steps (#134). Only run steps count: warm-up, cool-down,
 * walk and recovery steps, and anything after the last step (the walk home), never do. A step is
 * judged as it was recorded; planned run steps after the last recorded one were never reached and
 * count as missed. Null when there is nothing to judge: a run without recorded steps (a free run
 * linked afterwards) or a session without run steps. Only a hint: it never changes "done".
 */
export function judgeRunSteps(
  planned: readonly TimelineStep[],
  recorded: readonly RunStep[],
): RunStepVerdict | null {
  if (recorded.length === 0) return null
  const last = Math.max(...recorded.map((s) => s.position))
  const steps: { step: TimelineStep; recorded: RunStep | null }[] = [
    ...recorded.filter((s) => s.kind === 'run').map((s) => ({ step: s, recorded: s })),
    ...planned
      .filter((s) => s.kind === 'run' && s.position > last)
      .map((s) => ({ step: s, recorded: null })),
  ]
  if (steps.length === 0) return null
  let total = 0
  let off = 0
  let offSteps = 0
  for (const { step, recorded: done } of steps) {
    const weight = plannedSeconds(step, done)
    total += weight
    if (done === null || stepIsOff(done)) {
      off += weight
      offSteps++
    }
  }
  return { runSteps: steps.length, offSteps, offPlan: total > 0 && off > total * OFF_PLAN_SHARE }
}

/**
 * The sessions to mark off plan in a program: those whose judged runs were all off plan. A redo
 * that went to plan clears the mark; a run that could not be judged leaves it as it is.
 */
export function offPlanSessions(
  timelines: ReadonlyMap<string, readonly TimelineStep[]>,
  runs: readonly { sessionId: string | null; steps: readonly RunStep[] }[],
): Set<string> {
  const off = new Set<string>()
  const onPlan = new Set<string>()
  for (const r of runs) {
    if (r.sessionId === null) continue
    const verdict = judgeRunSteps(timelines.get(r.sessionId) ?? [], r.steps)
    if (verdict === null) continue
    if (verdict.offPlan) off.add(r.sessionId)
    else onPlan.add(r.sessionId)
  }
  for (const id of onPlan) off.delete(id)
  return off
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
