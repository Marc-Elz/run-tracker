import { describe, expect, it } from 'vitest'
import { compareToPlan, plannedTotals } from '../planVsDone'
import type { SessionStep } from '../training'

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
