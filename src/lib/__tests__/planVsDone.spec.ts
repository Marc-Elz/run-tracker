import { describe, expect, it } from 'vitest'
import { compareToPlan, plannedTotals, weekSummary, type PlannedTotals } from '../planVsDone'
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
