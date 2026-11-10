import { describe, expect, it } from 'vitest'
import type { SessionStep } from '../training'
import {
  advanceSteps,
  applyChange,
  closeOpenStep,
  expandSteps,
  nextStepByHand,
  nextStepLabel,
  stepKindLabel,
  stepProgress,
  type RunStep,
  type StepTotals,
  type TimelineStep,
} from '../stepProgress'

let ids = 0
const step = (over: Partial<SessionStep> = {}): SessionStep => ({
  id: `s${ids++}`,
  sessionId: 'session',
  position: 0,
  kind: 'run',
  targetKind: 'none',
  targetValue: null,
  paceMin: null,
  paceMax: null,
  repetitions: null,
  span: null,
  ...over,
})
const timed = (kind: SessionStep['kind'], seconds: number) =>
  step({ kind, targetKind: 'duration', targetValue: seconds })
const metres = (kind: SessionStep['kind'], m: number) =>
  step({ kind, targetKind: 'distance', targetValue: m })
const repeat = (repetitions: number, span: number) => step({ kind: 'repeat', repetitions, span })
const at = (elapsedMs: number, distanceM = 0): StepTotals => ({ elapsedMs, distanceM })

/** Feed totals one after the other, as the composable does on each tick */
function follow(timeline: TimelineStep[], ...ticks: StepTotals[]): RunStep[] {
  let runSteps: RunStep[] = []
  for (const totals of ticks) {
    const change = advanceSteps(timeline, runSteps, totals)
    if (change) runSteps = applyChange(runSteps, change)
  }
  return runSteps
}

// Warm-up without target, then 2× (run 60 s, walk 90 s), then cool-down 400 m
const session = () =>
  expandSteps([
    step({ kind: 'warmup' }),
    repeat(2, 2),
    timed('run', 60),
    timed('walk', 90),
    metres('cooldown', 400),
  ])

describe('expandSteps', () => {
  it('writes repeats out in order, with round numbers', () => {
    const timeline = session()
    expect(timeline.map((s) => [s.position, s.kind, s.repetition, s.repetitions])).toEqual([
      [0, 'warmup', null, null],
      [1, 'run', 1, 2],
      [2, 'walk', 1, 2],
      [3, 'run', 2, 2],
      [4, 'walk', 2, 2],
      [5, 'cooldown', null, null],
    ])
    expect(timeline[1]).toMatchObject({ targetKind: 'duration', targetValue: 60 })
  })

  it('gives an empty timeline for a session without steps', () => {
    expect(expandSteps([])).toEqual([])
  })
})

describe('advanceSteps', () => {
  const runWalk = () => expandSteps([repeat(3, 2), timed('run', 60), timed('walk', 90)])

  it('starts the first step at 0:00 and 0 m, even when loaded late', () => {
    const change = advanceSteps(runWalk(), [], at(5_000, 12))
    expect(change?.ended).toBeNull()
    expect(change?.started).toEqual([
      expect.objectContaining({ position: 0, startedElapsedMs: 0, startedDistanceM: 0 }),
    ])
  })

  it('changes nothing while the step is not due', () => {
    const timeline = runWalk()
    const runSteps = follow(timeline, at(0))
    expect(advanceSteps(timeline, runSteps, at(59_999, 200))).toBeNull()
  })

  it('ends a duration step at exactly its target time, however late the tick', () => {
    const timeline = runWalk()
    const runSteps = follow(timeline, at(0), at(60_800, 180))
    expect(runSteps[0]).toMatchObject({ endedElapsedMs: 60_000, endedDistanceM: 180 })
    expect(runSteps[1]).toMatchObject({ position: 1, startedElapsedMs: 60_000 })
    // So the next one still ends at 2:30, not 2:30.8
    const after = follow(timeline, at(0), at(60_800, 180), at(150_000, 300))
    expect(after[1]).toMatchObject({ endedElapsedMs: 150_000 })
  })

  it('a pause stops the step: only the run totals move it on', () => {
    const timeline = runWalk()
    // The same elapsed time, however long the pause was on the wall clock
    expect(follow(timeline, at(0), at(30_000), at(30_000))).toHaveLength(1)
  })

  it('moves on through several steps due at once, each ending at its own target', () => {
    const timeline = runWalk()
    const runSteps = follow(timeline, at(0), at(400_000, 1000))
    expect(runSteps.map((s) => [s.startedElapsedMs, s.endedElapsedMs])).toEqual([
      [0, 60_000],
      [60_000, 150_000],
      [150_000, 210_000],
      [210_000, 300_000],
      [300_000, 360_000],
      [360_000, null],
    ])
  })

  it('reports the open step that ended separately from the ones that started', () => {
    const timeline = runWalk()
    const runSteps = follow(timeline, at(0))
    const change = advanceSteps(timeline, runSteps, at(160_000, 500))!
    expect(change.ended).toMatchObject({ position: 0, endedElapsedMs: 60_000 })
    expect(change.started.map((s) => [s.position, s.endedElapsedMs])).toEqual([
      [1, 150_000],
      [2, null],
    ])
  })

  it('ends a distance step at its target distance and the current time', () => {
    const timeline = expandSteps([metres('run', 400), metres('walk', 100), metres('run', 200)])
    // A GPS jump past the first two steps
    const runSteps = follow(timeline, at(0), at(150_000, 520))
    expect(runSteps.map((s) => [s.startedDistanceM, s.endedDistanceM, s.endedElapsedMs])).toEqual([
      [0, 400, 150_000],
      [400, 500, 150_000],
      [500, null, null],
    ])
    expect(stepProgress(timeline, runSteps, at(150_000, 520))).toMatchObject({
      index: 2,
      leftM: 180,
    })
  })

  it('never ends a step without a target by itself', () => {
    const timeline = expandSteps([step({ kind: 'warmup' }), timed('run', 60)])
    expect(follow(timeline, at(0), at(3_600_000, 9000))).toHaveLength(1)
  })

  it('does nothing without a timeline or once the last step ended', () => {
    expect(advanceSteps([], [], at(1000))).toBeNull()
    const timeline = expandSteps([timed('run', 60)])
    const runSteps = follow(timeline, at(0), at(61_000))
    expect(runSteps[0]!.endedElapsedMs).toBe(60_000)
    expect(advanceSteps(timeline, runSteps, at(120_000))).toBeNull()
  })
})

describe('nextStepByHand', () => {
  it('ends a step without a target at the current totals and starts the next', () => {
    const timeline = session()
    const runSteps = follow(timeline, at(0), at(300_000, 800))
    const change = nextStepByHand(timeline, runSteps, at(300_000, 800))!
    expect(change.ended).toMatchObject({ position: 0, endedElapsedMs: 300_000, endedDistanceM: 800 })
    expect(change.started).toEqual([
      expect.objectContaining({ position: 1, startedElapsedMs: 300_000, startedDistanceM: 800 }),
    ])
  })

  it('does nothing on a step with a target', () => {
    const timeline = expandSteps([timed('run', 60), step({ kind: 'cooldown' })])
    const runSteps = follow(timeline, at(0))
    expect(nextStepByHand(timeline, runSteps, at(10_000))).toBeNull()
  })

  it('ends the session when it is the last step', () => {
    const timeline = expandSteps([step({ kind: 'cooldown' })])
    const runSteps = follow(timeline, at(0))
    const change = nextStepByHand(timeline, runSteps, at(10_000))!
    expect(change.started).toEqual([])
    const after = applyChange(runSteps, change)
    expect(stepProgress(timeline, after, at(12_000))?.done).toBe(true)
  })
})

describe('closeOpenStep', () => {
  it('ends the open step where the run ended', () => {
    const timeline = session()
    const runSteps = follow(timeline, at(0), at(320_000, 900))
    expect(closeOpenStep(runSteps, at(320_000, 900))).toMatchObject({
      position: 0,
      endedElapsedMs: 320_000,
      endedDistanceM: 900,
    })
  })

  it('returns null when nothing is open', () => {
    expect(closeOpenStep([], at(1000))).toBeNull()
  })
})

describe('stepProgress', () => {
  it('is null without a timeline', () => {
    expect(stepProgress([], [], at(0))).toBeNull()
  })

  it('shows the first step before it is stored', () => {
    expect(stepProgress(session(), [], at(2_000))).toMatchObject({
      index: 0,
      count: 6,
      inStepMs: 2_000,
      leftMs: null,
      next: expect.objectContaining({ kind: 'run', repetition: 1 }),
      done: false,
    })
  })

  it('gives the time left in a duration step, the next step and the count', () => {
    const timeline = session()
    const warmingUp = follow(timeline, at(0))
    const runSteps = applyChange(warmingUp, nextStepByHand(timeline, warmingUp, at(100_000))!)
    expect(stepProgress(timeline, runSteps, at(123_000))).toMatchObject({
      index: 1,
      count: 6,
      leftMs: 37_000,
      leftM: null,
      inStepMs: 23_000,
      current: expect.objectContaining({ kind: 'run' }),
      next: expect.objectContaining({ kind: 'walk', repetition: 1 }),
    })
  })

  it('clamps what is left when the totals sit below the step start (after a recover)', () => {
    const timeline = expandSteps([timed('run', 60), metres('walk', 100)])
    const runSteps: RunStep[] = [
      { ...timeline[0]!, startedElapsedMs: 0, startedDistanceM: 0, endedElapsedMs: 60_000, endedDistanceM: 150 },
      { ...timeline[1]!, startedElapsedMs: 60_000, startedDistanceM: 150, endedElapsedMs: null, endedDistanceM: null },
    ]
    expect(stepProgress(timeline, runSteps, at(58_000, 140))).toMatchObject({
      index: 1,
      leftM: 100,
      inStepMs: 0,
    })
  })

  it('is done once the last step ended', () => {
    const timeline = expandSteps([timed('run', 60)])
    const runSteps = follow(timeline, at(0), at(61_000))
    expect(stepProgress(timeline, runSteps, at(70_000))).toMatchObject({
      done: true,
      index: 0,
      count: 1,
      current: null,
      next: null,
    })
  })
})

describe('labels', () => {
  it('names the kind with its round', () => {
    const [warmup, run] = session()
    expect(stepKindLabel(warmup!)).toBe('Warm-up')
    expect(stepKindLabel(run!)).toBe('Run · rep 1/2')
  })

  it('describes the next step without its pace', () => {
    const timeline = expandSteps([
      repeat(6, 1),
      step({ kind: 'run', targetKind: 'duration', targetValue: 60, paceMin: 300, paceMax: 320 }),
      metres('walk', 350),
    ])
    expect(nextStepLabel(timeline[1]!)).toBe('Run 1:00 · rep 2/6')
    expect(nextStepLabel(timeline[6]!)).toBe('Walk 350 m')
  })
})
