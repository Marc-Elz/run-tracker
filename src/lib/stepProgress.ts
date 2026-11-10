/**
 * Following a training session's steps during a run (#101). Pure functions, no Vue, so the logic
 * can move to native code later (#83) without a rewrite. Steps move on from the run's own totals
 * (elapsed time without pauses, filtered distance), never from the wall clock.
 */
import {
  STEP_KIND_LABELS,
  stepSummary,
  toBlocks,
  type SessionStep,
  type StepKind,
  type TargetKind,
} from './training'

/** A step kind that is run; a repeat is written out into its steps */
export type RunStepKind = Exclude<StepKind, 'repeat'>

/** One step of the session written out in run order: a repeat's steps appear once per round */
export interface TimelineStep {
  /** 0..n-1 in the written-out list */
  position: number
  kind: RunStepKind
  targetKind: TargetKind
  /** Seconds for a duration, metres for a distance, null for none */
  targetValue: number | null
  paceMin: number | null
  paceMax: number | null
  /** Round 1..repetitions for a step inside a repeat, null outside one */
  repetition: number | null
  repetitions: number | null
}

/** A step as it was run: a copy of the plan, plus where in the run it started and ended */
export interface RunStep extends TimelineStep {
  startedElapsedMs: number
  startedDistanceM: number
  endedElapsedMs: number | null
  endedDistanceM: number | null
}

/** The run totals the steps follow */
export interface StepTotals {
  elapsedMs: number
  distanceM: number
}

/**
 * What changes: the open step that ended (an update), and the steps that started (inserts). A
 * started step may already have ended too, when several steps were due at once.
 */
export interface StepChange {
  ended: RunStep | null
  started: RunStep[]
}

export interface StepProgress {
  /** The step now running; null once the session is done */
  current: TimelineStep | null
  /** 0-based index of the current step (the last one when done) */
  index: number
  count: number
  /** Time left in a duration step, else null */
  leftMs: number | null
  /** Metres left in a distance step, else null */
  leftM: number | null
  /** Time spent in the current step so far */
  inStepMs: number
  next: TimelineStep | null
  done: boolean
}

/** A session's stored steps (valid, in order) written out in run order */
export function expandSteps(steps: SessionStep[]): TimelineStep[] {
  const timeline: TimelineStep[] = []
  const add = (step: SessionStep, repetition: number | null, repetitions: number | null) =>
    timeline.push({
      position: timeline.length,
      kind: step.kind as RunStepKind,
      targetKind: step.targetKind,
      targetValue: step.targetValue,
      paceMin: step.paceMin,
      paceMax: step.paceMax,
      repetition,
      repetitions,
    })
  for (const { step, children } of toBlocks(steps)) {
    if (step.kind !== 'repeat') {
      add(step, null, null)
      continue
    }
    const rounds = step.repetitions ?? 1
    for (let round = 1; round <= rounds; round++) {
      for (const child of children) add(child, round, rounds)
    }
  }
  return timeline
}

const startStep = (step: TimelineStep, at: StepTotals): RunStep => ({
  ...step,
  startedElapsedMs: at.elapsedMs,
  startedDistanceM: at.distanceM,
  endedElapsedMs: null,
  endedDistanceM: null,
})

/** Where a step ends at these totals, or null when it is not due yet (or never ends by itself) */
function dueEnd(step: RunStep, totals: StepTotals): StepTotals | null {
  if (step.targetValue === null) return null
  if (step.targetKind === 'duration') {
    // Exactly at the target time, so a late tick never shifts the steps after it
    const end = step.startedElapsedMs + step.targetValue * 1000
    if (totals.elapsedMs < end) return null
    return { elapsedMs: end, distanceM: Math.max(step.startedDistanceM, totals.distanceM) }
  }
  if (step.targetKind === 'distance') {
    const end = step.startedDistanceM + step.targetValue
    if (totals.distanceM < end) return null
    return { elapsedMs: Math.max(step.startedElapsedMs, totals.elapsedMs), distanceM: end }
  }
  return null
}

/** The open step: the last one when it has not ended */
const openStep = (runSteps: readonly RunStep[]): RunStep | null => {
  const last = runSteps[runSteps.length - 1]
  return last && last.endedElapsedMs === null ? last : null
}

/**
 * The steps that end and start at these totals, or null when nothing changes. The first step
 * starts at 0:00 and 0 m, whenever the steps were loaded; steps already due all move on at once.
 */
export function advanceSteps(
  timeline: readonly TimelineStep[],
  runSteps: readonly RunStep[],
  totals: StepTotals,
): StepChange | null {
  if (timeline.length === 0) return null
  const started: RunStep[] = []
  let ended: RunStep | null = null
  let current = openStep(runSteps)
  if (runSteps.length === 0) {
    current = startStep(timeline[0]!, { elapsedMs: 0, distanceM: 0 })
    started.push(current)
  }
  while (current) {
    const end = dueEnd(current, totals)
    if (!end) break
    const closed: RunStep = { ...current, endedElapsedMs: end.elapsedMs, endedDistanceM: end.distanceM }
    const i = started.indexOf(current)
    if (i >= 0) started[i] = closed
    else ended = closed
    const following = timeline[current.position + 1]
    current = following ? startStep(following, end) : null
    if (current) started.push(current)
  }
  return ended || started.length > 0 ? { ended, started } : null
}

/** A tap on Next step: ends the open step without a target here and starts the next one */
export function nextStepByHand(
  timeline: readonly TimelineStep[],
  runSteps: readonly RunStep[],
  totals: StepTotals,
): StepChange | null {
  const current = openStep(runSteps)
  if (!current || current.targetKind !== 'none') return null
  const end = {
    elapsedMs: Math.max(current.startedElapsedMs, totals.elapsedMs),
    distanceM: Math.max(current.startedDistanceM, totals.distanceM),
  }
  const following = timeline[current.position + 1]
  return {
    ended: { ...current, endedElapsedMs: end.elapsedMs, endedDistanceM: end.distanceM },
    started: following ? [startStep(following, end)] : [],
  }
}

/** Stop: the open step ends where the run ended, so a finished run has no open step */
export function closeOpenStep(runSteps: readonly RunStep[], totals: StepTotals): RunStep | null {
  const current = openStep(runSteps)
  if (!current) return null
  return {
    ...current,
    endedElapsedMs: Math.max(current.startedElapsedMs, totals.elapsedMs),
    endedDistanceM: Math.max(current.startedDistanceM, totals.distanceM),
  }
}

/** The run steps after a change: the ended one replaced, the started ones added */
export function applyChange(runSteps: readonly RunStep[], change: StepChange): RunStep[] {
  const next = change.ended
    ? runSteps.map((s) => (s.position === change.ended!.position ? change.ended! : s))
    : [...runSteps]
  return [...next, ...change.started]
}

const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max)

/** What the Run screen shows; null without a timeline */
export function stepProgress(
  timeline: readonly TimelineStep[],
  runSteps: readonly RunStep[],
  totals: StepTotals,
): StepProgress | null {
  const count = timeline.length
  if (count === 0) return null
  const last = runSteps[runSteps.length - 1]
  if (last && last.endedElapsedMs !== null && last.position >= count - 1) {
    return {
      current: null,
      index: count - 1,
      count,
      leftMs: null,
      leftM: null,
      inStepMs: 0,
      next: null,
      done: true,
    }
  }
  // Before the first step is stored it is shown as started at 0:00, where it will start
  const open = openStep(runSteps) ?? startStep(timeline[0]!, { elapsedMs: 0, distanceM: 0 })
  const target = open.targetValue
  // After a recover the totals can sit slightly below a recorded start: clamp "left"
  const leftMs =
    open.targetKind === 'duration' && target !== null
      ? clamp(open.startedElapsedMs + target * 1000 - totals.elapsedMs, target * 1000)
      : null
  const leftM =
    open.targetKind === 'distance' && target !== null
      ? clamp(open.startedDistanceM + target - totals.distanceM, target)
      : null
  return {
    current: timeline[open.position] ?? null,
    index: open.position,
    count,
    leftMs,
    leftM,
    inStepMs: Math.max(0, totals.elapsedMs - open.startedElapsedMs),
    next: timeline[open.position + 1] ?? null,
    done: false,
  }
}

/** "Walk" or "Walk · rep 2/6" */
export function stepKindLabel(step: TimelineStep): string {
  const label = STEP_KIND_LABELS[step.kind]
  return step.repetition === null ? label : `${label} · rep ${step.repetition}/${step.repetitions}`
}

/**
 * One line for the next step: "Run 1:00 · rep 2/6". Without the target pace, which comes with
 * pace corrections (#103).
 */
export function nextStepLabel(step: TimelineStep): string {
  const text = stepSummary({
    id: '',
    sessionId: '',
    position: step.position,
    kind: step.kind,
    targetKind: step.targetKind,
    targetValue: step.targetValue,
    paceMin: null,
    paceMax: null,
    repetitions: null,
    span: null,
  })
  return step.repetition === null ? text : `${text} · rep ${step.repetition}/${step.repetitions}`
}
