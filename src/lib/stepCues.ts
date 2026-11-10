/**
 * Spoken coaching for a training session's steps (#66). Pure functions, no Vue, like `cues.ts`:
 * what is said and when comes from the step progress of #101, never from the wall clock.
 */
import { spokenDistance, spokenDuration } from './cues'
import { STEP_KIND_LABELS } from './training'
import type { RunStep, StepTotals, TimelineStep } from './stepProgress'

/** A timed step warns this long before it ends */
export const WARN_LEAD_S = 10
/** A distance step warns this far before it ends */
export const WARN_LEAD_M = 50
/** Shorter steps get no warning: it would land right on top of their own announcement */
const MIN_WARN_STEP_S = 30
const MIN_WARN_STEP_M = 200

export const DONE_TEXT = 'Session done'

/** What was already said, so nothing repeats after a pause, a resume or a recovered run */
export interface StepCueState {
  /** Position of the last step announced; -1 before the first */
  announced: number
  /** Position of the last step whose change was warned about */
  warned: number
  doneSaid: boolean
}

export interface StepCue {
  text: string
  /** A step change (or the end) also vibrates; a warning does not */
  vibrate: boolean
  state: StepCueState
}

const openStep = (runSteps: readonly RunStep[]): RunStep | null => {
  const last = runSteps[runSteps.length - 1]
  return last && last.endedElapsedMs === null ? last : null
}

/** A run this young is a fresh start, not a resume: its first step has not been said yet */
const FRESH_RUN_MS = 3000

/**
 * Starting state for a run seen running: the step under way counts as announced and warned, so
 * a resume or a recovered run repeats nothing. The first step of a run that has only just begun
 * is the exception: the steps are stored in the same tick, before this runs, and it still has
 * to be said.
 */
export function initStepCueState(
  timeline: readonly TimelineStep[],
  runSteps: readonly RunStep[],
  totals: StepTotals,
): StepCueState {
  const open = openStep(runSteps)
  const last = runSteps[runSteps.length - 1]
  const done = !open && !!last && last.position >= timeline.length - 1
  const position = last ? last.position : -1
  const fresh = !!open && open.position === 0 && totals.elapsedMs < FRESH_RUN_MS
  return { announced: fresh ? -1 : position, warned: position, doneSaid: done }
}

function spokenTarget(step: TimelineStep): string {
  if (step.targetValue === null) return ''
  if (step.targetKind === 'duration') return spokenDuration(step.targetValue)
  if (step.targetKind === 'distance') {
    return step.targetValue < 1000 ? `${step.targetValue} metres` : spokenDistance(step.targetValue)
  }
  return ''
}

function spokenPace(step: TimelineStep): string {
  const { paceMin, paceMax } = step
  if (paceMin === null && paceMax === null) return ''
  if (paceMin !== null && paceMax !== null && paceMin !== paceMax) {
    const lo = Math.min(paceMin, paceMax)
    const hi = Math.max(paceMin, paceMax)
    return `pace between ${spokenDuration(lo)} and ${spokenDuration(hi)} per kilometre`
  }
  return `pace ${spokenDuration((paceMin ?? paceMax)!)} per kilometre`
}

/** "Run, 1 minute, pace 5 minutes per kilometre"; "Last one. Walk, 2 minutes" at the start of the final round */
export function announceText(step: TimelineStep, previous: TimelineStep | null): string {
  const parts = [STEP_KIND_LABELS[step.kind], spokenTarget(step), spokenPace(step)].filter(Boolean)
  const text = parts.join(', ')
  const finalRoundStart =
    step.repetition !== null &&
    step.repetitions !== null &&
    step.repetitions > 1 &&
    step.repetition === step.repetitions &&
    previous?.repetition !== step.repetition
  return finalRoundStart ? `Last one. ${text}` : text
}

/** "Run in 10 seconds" / "Walk in 50 metres": what is coming, said just before it */
export function warningText(current: TimelineStep, next: TimelineStep): string {
  const lead = current.targetKind === 'distance' ? `${WARN_LEAD_M} metres` : `${WARN_LEAD_S} seconds`
  return `${STEP_KIND_LABELS[next.kind]} in ${lead}`
}

/** Is the open step within the warning lead of its end (and long enough to warrant a warning)? */
export function warningDue(step: RunStep, totals: StepTotals): boolean {
  if (step.targetValue === null) return false
  if (step.targetKind === 'duration') {
    if (step.targetValue < MIN_WARN_STEP_S) return false
    const end = step.startedElapsedMs + step.targetValue * 1000
    return totals.elapsedMs >= end - WARN_LEAD_S * 1000
  }
  if (step.targetKind === 'distance') {
    if (step.targetValue < MIN_WARN_STEP_M) return false
    const end = step.startedDistanceM + step.targetValue
    return totals.distanceM >= end - WARN_LEAD_M
  }
  return false
}

/**
 * The line to speak now, with the state after it, or null. Steps that all came due in one tick
 * (a late tick, a catch-up after a recovery) give only the newest one, never a backlog.
 */
export function nextStepCue(
  state: StepCueState,
  timeline: readonly TimelineStep[],
  runSteps: readonly RunStep[],
  totals: StepTotals,
): StepCue | null {
  if (timeline.length === 0) return null
  const open = openStep(runSteps)
  if (open) {
    if (open.position > state.announced) {
      return {
        text: announceText(open, timeline[open.position - 1] ?? null),
        vibrate: true,
        state: { ...state, announced: open.position, warned: open.position - 1 },
      }
    }
    const next = timeline[open.position + 1]
    if (next && state.warned < open.position && warningDue(open, totals)) {
      return {
        text: warningText(open, next),
        vibrate: false,
        state: { ...state, warned: open.position },
      }
    }
    return null
  }
  const last = runSteps[runSteps.length - 1]
  if (last && last.position >= timeline.length - 1 && !state.doneSaid) {
    return { text: DONE_TEXT, vibrate: true, state: { ...state, doneSaid: true } }
  }
  return null
}
