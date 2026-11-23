import { describe, expect, it } from 'vitest'
import {
  compareToPlan,
  judgeRunSteps,
  OFF_PLAN_SHARE,
  OFF_PLAN_TOLERANCE,
  offPlanSessions,
  plannedTotals,
  WALKING_PACE_S_PER_KM,
  weekSummary,
  type PlannedTotals,
} from '../planVsDone'
import type { RunStep, TimelineStep } from '../stepProgress'
import type { ProgramSession, SessionStep } from '../training'

const step = (over: Partial<SessionStep>): SessionStep => ({
  id: 'x',
  sessionId: 's',
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
const timed = (seconds: number, kind: SessionStep['kind'] = 'run') =>
  step({ kind, targetKind: 'duration', targetValue: seconds })
const metres = (m: number) => step({ targetKind: 'distance', targetValue: m })

describe('plannedTotals', () => {
  it('adds up the time of steps that all have a time target', () => {
    expect(plannedTotals([timed(300, 'warmup'), timed(1200), timed(300, 'cooldown')])).toEqual({
      seconds: 1800,
      metres: null,
    })
  })

  it('adds up the distance of steps that all have a distance target', () => {
    expect(plannedTotals([metres(400), metres(1000)])).toEqual({ seconds: null, metres: 1400 })
  })

  it('counts a repeat once per round', () => {
    const steps = [step({ kind: 'repeat', repetitions: 3, span: 2 }), timed(60), timed(90, 'walk')]
    expect(plannedTotals(steps).seconds).toBe(3 * 150)
  })

  it('gives no total when a step has no target, or targets are mixed', () => {
    expect(plannedTotals([timed(300), step({ kind: 'cooldown' })])).toEqual({
      seconds: null,
      metres: null,
    })
    expect(plannedTotals([timed(300), metres(400)])).toEqual({ seconds: null, metres: null })
  })

  it('gives no total for a session without steps', () => {
    expect(plannedTotals([])).toEqual({ seconds: null, metres: null })
  })
})

describe('compareToPlan', () => {
  const run = { elapsedMs: 1_830_400, distanceM: 4210 }

  it('compares time in seconds', () => {
    expect(compareToPlan({ seconds: 1800, metres: null }, run)).toEqual([
      { kind: 'time', planned: 1800, done: 1830 },
    ])
  })

  it('compares distance in metres', () => {
    expect(compareToPlan({ seconds: null, metres: 5000 }, run)).toEqual([
      { kind: 'distance', planned: 5000, done: 4210 },
    ])
  })

  it('gives nothing when the plan has no total', () => {
    expect(compareToPlan({ seconds: null, metres: null }, run)).toEqual([])
  })
})

describe('weekSummary', () => {
  const week = (...ids: string[]): ProgramSession[] =>
    ids.map((id, position) => ({
      id,
      programId: 'p',
      week: 1,
      position,
      type: id === 'rest' ? 'rest' : 'easy',
      title: id,
      notes: null,
    }))
  const planned = new Map<string, PlannedTotals>([
    ['a', { seconds: 1800, metres: null }],
    ['b', { seconds: 1200, metres: null }],
    ['c', { seconds: 600, metres: null }],
  ])
  const ran = (sessionId: string | null, elapsedMs: number, distanceM: number) => ({
    sessionId,
    elapsedMs,
    distanceM,
  })

  it('counts sessions done of the sessions that can be run, rest days left out', () => {
    const w = weekSummary(
      week('a', 'rest', 'b', 'c'),
      planned,
      [ran('a', 1_700_000, 5000)],
      new Set(),
    )
    expect(w).toMatchObject({ sessions: 3, done: 1, skipped: 0 })
  })

  it('adds up done time and distance of every linked run, a redo included, and no other run', () => {
    const runs = [
      ran('a', 1_800_000, 4000),
      ran('a', 600_000, 1500),
      ran('b', 1_200_000, 3000),
      ran(null, 3_600_000, 9000),
      ran('elsewhere', 3_600_000, 9000),
    ]
    const w = weekSummary(week('a', 'b', 'c'), planned, runs, new Set())
    expect(w).toMatchObject({ done: 2, doneSeconds: 3600, doneMetres: 8500 })
  })

  it('adds up the planned time of all counted sessions', () => {
    expect(weekSummary(week('a', 'b', 'c'), planned, [], new Set()).plannedSeconds).toBe(3600)
  })

  it('leaves a skipped session out of the planned amounts, and counts it apart', () => {
    const w = weekSummary(week('a', 'b', 'c'), planned, [], new Set(['b']))
    expect(w).toMatchObject({ skipped: 1, plannedSeconds: 2400 })
  })

  it('counts a skipped session that was run as done, with its plan', () => {
    const w = weekSummary(week('a', 'b'), planned, [ran('b', 1_000_000, 0)], new Set(['b']))
    expect(w).toMatchObject({ done: 1, skipped: 0, plannedSeconds: 3000 })
  })

  it('has no planned total when a counted session has none, or the week has nothing to run', () => {
    expect(weekSummary(week('a', 'x'), planned, [], new Set()).plannedSeconds).toBeNull()
    expect(weekSummary(week('a', 'x'), planned, [], new Set(['x'])).plannedSeconds).toBe(1800)
    expect(weekSummary(week('rest'), planned, [], new Set())).toMatchObject({
      sessions: 0,
      plannedSeconds: null,
      plannedMetres: null,
    })
  })
})

describe('off plan (#134)', () => {
  /** A planned step at its position in the written-out session */
  const planStep = (position: number, over: Partial<TimelineStep> = {}): TimelineStep => ({
    position,
    kind: 'run',
    targetKind: 'duration',
    targetValue: 180,
    paceMin: null,
    paceMax: 465, // 7:45 min/km
    repetition: null,
    repetitions: null,
    ...over,
  })
  /** The step as run: `seconds` long over `metres`, starting where the one before ended */
  const ran = (step: TimelineStep, seconds: number, metres: number, from = 0): RunStep => ({
    ...step,
    startedElapsedMs: from * 1000,
    startedDistanceM: from,
    endedElapsedMs: (from + seconds) * 1000,
    endedDistanceM: from + metres,
  })
  // Warm-up, 3× (run 3:00, walk 1:00), open cool-down
  const plan: TimelineStep[] = [
    planStep(0, { kind: 'warmup', targetKind: 'none', targetValue: null, paceMax: null }),
    planStep(1),
    planStep(2, { kind: 'walk', targetValue: 60, paceMax: null }),
    planStep(3),
    planStep(4, { kind: 'walk', targetValue: 60, paceMax: null }),
    planStep(5),
    planStep(6, { kind: 'cooldown', targetKind: 'none', targetValue: null, paceMax: null }),
  ]
  // 3:00 over 400 m is 7:30 min/km: on pace. Over 200 m it is 15:00 min/km: walked.
  const onPace = (p: number) => ran(plan[p]!, 180, 400)
  const walked = (p: number) => ran(plan[p]!, 180, 200)
  const rest = (p: number, seconds = 60, metres = 80) => ran(plan[p]!, seconds, metres)

  it('has its thresholds in named constants', () => {
    expect(OFF_PLAN_TOLERANCE).toBe(0.2)
    expect(WALKING_PACE_S_PER_KM).toBe(600)
    expect(OFF_PLAN_SHARE).toBe(0.5)
  })

  it('is on plan when the run steps were run, however slow the rest and the walk home', () => {
    // A slow warm-up, a walked cool-down of 20 minutes: none of it counts
    const steps = [rest(0, 600, 300), onPace(1), rest(2), onPace(3), rest(4), onPace(5)]
    steps.push(rest(6, 1200, 1500))
    expect(judgeRunSteps(plan, steps)).toEqual({ runSteps: 3, offSteps: 0, offPlan: false })
  })

  it('is off plan when more than half of the run time was walked', () => {
    const steps = [rest(0), walked(1), rest(2), walked(3), rest(4), onPace(5), rest(6)]
    expect(judgeRunSteps(plan, steps)).toEqual({ runSteps: 3, offSteps: 2, offPlan: true })
  })

  it('lets one walked step out of three pass', () => {
    const steps = [rest(0), walked(1), rest(2), onPace(3), rest(4), onPace(5), rest(6)]
    expect(judgeRunSteps(plan, steps)?.offPlan).toBe(false)
  })

  it('allows 20% slower than the slowest pace, and no more', () => {
    // 7:45 + 20% = 9:18 min/km, 558 s/km: 180 s over 323 m is 557 s/km, over 322 m 559 s/km
    const at = (metres: number) => [1, 3, 5].map((p) => ran(plan[p]!, 180, metres))
    expect(judgeRunSteps(plan, at(323))?.offPlan).toBe(false)
    expect(judgeRunSteps(plan, at(322))?.offPlan).toBe(true)
  })

  it('judges a run step without a pace target against walking pace', () => {
    const open = plan.map((s) => ({ ...s, paceMax: null }))
    // 10:00 min/km is 300 m in 3:00
    const at = (metres: number) => [1, 3, 5].map((p) => ran(open[p]!, 180, metres))
    expect(judgeRunSteps(open, at(300))?.offPlan).toBe(false)
    expect(judgeRunSteps(open, at(290))?.offPlan).toBe(true)
  })

  it('counts run steps cut short by more than 20%, or never reached, as missed', () => {
    const short = [rest(0), ran(plan[1]!, 140, 320), rest(2), ran(plan[3]!, 140, 320)]
    expect(judgeRunSteps(plan, short)).toEqual({ runSteps: 3, offSteps: 3, offPlan: true })
    const stopped = [rest(0), onPace(1), rest(2)]
    expect(judgeRunSteps(plan, stopped)).toEqual({ runSteps: 3, offSteps: 2, offPlan: true })
  })

  it('judges a distance step by its distance and pace, weighted by its time at the slowest pace', () => {
    const km = planStep(1, { targetKind: 'distance', targetValue: 1000 })
    const distancePlan = [km, planStep(2, { position: 2 })]
    // 1 km at 7:30 is on plan, though the 3:00 step after it was walked: 465 s against 180 s
    const steps = [ran(km, 450, 1000), ran(distancePlan[1]!, 180, 200)]
    expect(judgeRunSteps(distancePlan, steps)).toEqual({ runSteps: 2, offSteps: 1, offPlan: false })
    expect(judgeRunSteps(distancePlan, [ran(km, 450, 700)])?.offSteps).toBe(2)
  })

  it('judges nothing without recorded steps, or without run steps in the plan', () => {
    expect(judgeRunSteps(plan, [])).toBeNull()
    const walk = [planStep(0, { kind: 'walk', targetValue: 1800, paceMax: null })]
    expect(judgeRunSteps(walk, [ran(walk[0]!, 3000, 1000)])).toBeNull()
  })

  describe('offPlanSessions', () => {
    const timelines = new Map([
      ['a', plan],
      ['b', plan],
    ])
    const good = [rest(0), onPace(1), rest(2), onPace(3), rest(4), onPace(5)]
    const bad = [rest(0), walked(1), rest(2), walked(3), rest(4), walked(5)]

    it('marks sessions whose run went off plan, and no others', () => {
      const runs = [
        { sessionId: 'a', steps: bad },
        { sessionId: 'b', steps: good },
      ]
      expect(offPlanSessions(timelines, runs)).toEqual(new Set(['a']))
    })

    it('marks nothing for an unlinked run or a run without recorded steps', () => {
      const runs = [
        { sessionId: null, steps: bad },
        { sessionId: 'a', steps: [] },
      ]
      expect(offPlanSessions(timelines, runs)).toEqual(new Set())
    })

    it('clears the mark when a redo of the session went to plan', () => {
      const redo = [
        { sessionId: 'a', steps: bad },
        { sessionId: 'a', steps: good },
      ]
      expect(offPlanSessions(timelines, redo)).toEqual(new Set())
    })
  })
})
