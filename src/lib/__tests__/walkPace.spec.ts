import { describe, expect, it } from 'vitest'
import type { RunStep } from '../stepProgress'
import {
  effectiveWalkFloor,
  suggestWalkFloor,
  typedOrSuggested,
  usableWalkSteps,
  walkFloorFor,
  type RunWithSteps,
} from '../walkPace'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 23, 12)

/** A finished step of `seconds` over `metres`, starting at run time `fromS` */
function step(kind: RunStep['kind'], seconds: number, metres: number, fromS = 0): RunStep {
  return {
    position: 0,
    kind,
    targetKind: 'duration',
    targetValue: seconds,
    paceMin: null,
    paceMax: null,
    repetition: null,
    repetitions: null,
    startedElapsedMs: fromS * 1000,
    startedDistanceM: fromS,
    endedElapsedMs: (fromS + seconds) * 1000,
    endedDistanceM: fromS + metres,
  }
}

/** A run `daysAgo` with one walk step of `minutes` at `pace` s/km */
function walkRun(daysAgo: number, minutes: number, pace: number): RunWithSteps {
  const seconds = minutes * 60
  return { startedAt: NOW - daysAgo * DAY, steps: [step('walk', seconds, (seconds / pace) * 1000)] }
}

describe('usableWalkSteps', () => {
  it('keeps finished walk steps of at least 60 s and 50 m', () => {
    const unfinished = { ...step('walk', 300, 500), endedElapsedMs: null, endedDistanceM: null }
    expect(
      usableWalkSteps([
        step('walk', 300, 500),
        step('run', 300, 900),
        step('walk', 59, 100), // too short
        step('walk', 120, 40), // too little distance, GPS lag
        unfinished,
      ]),
    ).toEqual([{ seconds: 300, metres: 500 }])
  })

  it('takes the step time from run_steps, so paused time is left out', () => {
    // 10 min of run time over 1 km, however long the stops in between were
    const s = step('walk', 600, 1000, 120)
    expect(usableWalkSteps([s])).toEqual([{ seconds: 600, metres: 1000 }])
  })
})

describe('suggestWalkFloor', () => {
  it('is the typical pace + 0:30, rounded to 5 s, and says what it is based on', () => {
    const runs = [walkRun(1, 10, 593), walkRun(3, 10, 593)] // 9:53
    expect(suggestWalkFloor(runs, NOW)).toEqual({ pace: 625, runs: 2, since: NOW - 3 * DAY })
  })

  it('weights the steps by distance', () => {
    // A long brisk walk outweighs two short slow ones: the median by step count would be 12:00
    const runs: RunWithSteps[] = [
      {
        startedAt: NOW - DAY,
        steps: [step('walk', 3000, 5000), step('walk', 72, 100), step('walk', 72, 100)],
      },
      walkRun(2, 2, 720),
    ]
    expect(suggestWalkFloor(runs, NOW)).toMatchObject({ pace: 630 }) // 10:00 + 0:30
  })

  it('uses only the last 5 runs with walk steps, within 6 weeks', () => {
    const runs = [
      walkRun(1, 10, 600),
      { startedAt: NOW - 2 * DAY, steps: [step('run', 1800, 5000)] }, // no walk steps: skipped
      walkRun(3, 10, 600),
      walkRun(4, 10, 600),
      walkRun(5, 10, 600),
      walkRun(6, 10, 600),
      walkRun(7, 10, 900), // sixth walk: left out
      walkRun(50, 10, 900), // too old
    ]
    expect(suggestWalkFloor(runs, NOW)).toEqual({ pace: 630, runs: 5, since: NOW - 6 * DAY })
    expect(suggestWalkFloor([walkRun(43, 10, 600), walkRun(44, 10, 600)], NOW)).toHaveProperty(
      'reason',
    )
  })

  it('counts walk breaks of a run/walk session too', () => {
    const runwalk = (daysAgo: number): RunWithSteps => ({
      startedAt: NOW - daysAgo * DAY,
      steps: [
        step('run', 300, 900),
        step('walk', 180, 300, 300),
        step('run', 300, 900, 480),
        step('walk', 180, 300, 780),
      ],
    })
    expect(suggestWalkFloor([runwalk(1), runwalk(2)], NOW)).toMatchObject({ pace: 630, runs: 2 })
  })

  it('gives no suggestion with fewer than 2 walks or under 10 min of walk steps, and says why', () => {
    expect(suggestWalkFloor([], NOW)).toEqual({
      reason: 'needs 2 walks with 10 min of walk steps (so far 0 walks, 0 min)',
    })
    expect(suggestWalkFloor([walkRun(1, 30, 600)], NOW)).toEqual({
      reason: 'needs 2 walks with 10 min of walk steps (so far 1 walk, 30 min)',
    })
    expect(suggestWalkFloor([walkRun(1, 4, 600), walkRun(2, 5, 600)], NOW)).toEqual({
      reason: 'needs 2 walks with 10 min of walk steps (so far 2 walks, 9 min)',
    })
    expect(suggestWalkFloor([walkRun(1, 5, 600), walkRun(2, 5, 600)], NOW)).toHaveProperty('pace')
  })
})

describe('typedOrSuggested', () => {
  it('lets a typed value win until cleared, and offers a different suggestion', () => {
    expect(typedOrSuggested(null, 620)).toEqual({ value: 620, newerSuggestion: null })
    expect(typedOrSuggested(635, 620)).toEqual({ value: 635, newerSuggestion: 620 })
    expect(typedOrSuggested(620, 620)).toEqual({ value: 620, newerSuggestion: null })
    expect(typedOrSuggested(635, null)).toEqual({ value: 635, newerSuggestion: null })
    expect(typedOrSuggested(null, null)).toEqual({ value: null, newerSuggestion: null })
  })
})

describe('effectiveWalkFloor', () => {
  const suggestion = { pace: 620, runs: 3, since: NOW }

  it('is no floor when off', () => {
    expect(effectiveWalkFloor({ on: false, typed: 635 }, suggestion).floor).toBeNull()
  })

  it('is the typed pace, else the suggested one, else none', () => {
    expect(effectiveWalkFloor({ on: true, typed: 635 }, suggestion)).toEqual({
      floor: 635,
      newerSuggestion: 620,
    })
    expect(effectiveWalkFloor({ on: true, typed: null }, suggestion).floor).toBe(620)
    expect(effectiveWalkFloor({ on: true, typed: null }, { reason: 'x' }).floor).toBeNull()
    expect(effectiveWalkFloor({ on: true, typed: null }, null).floor).toBeNull()
  })
})

describe('walkFloorFor', () => {
  it('applies to walk sessions, and to run/walk breaks only when asked for', () => {
    expect(walkFloorFor('walk', 630, false)).toBe(630)
    expect(walkFloorFor('runwalk', 630, false)).toBeNull()
    expect(walkFloorFor('runwalk', 630, true)).toBe(630)
    expect(walkFloorFor('easy', 630, true)).toBeNull()
    expect(walkFloorFor(null, 630, true)).toBeNull()
  })
})
