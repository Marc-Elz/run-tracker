import { describe, expect, it } from 'vitest'
import { cueText, initCueState, nextCue, retargetCueState, type CueConfig } from '../cues'

const km: CueConfig = { distanceKm: 1, timeMin: 0 }
const both: CueConfig = { distanceKm: 1, timeMin: 5 }
const MIN = 60_000

describe('cueText', () => {
  it('speaks distance, time and pace in metric units', () => {
    expect(cueText(1000, 332_000, 332)).toBe(
      '1 kilometre, 5 minutes 32 seconds, pace 5 minutes 32 seconds per kilometre',
    )
  })

  it('cuts the distance to 10 m and pluralises', () => {
    expect(cueText(1003, 300_000, null)).toBe('1 kilometre, 5 minutes')
    expect(cueText(2000, 600_000, null)).toBe('2 kilometres, 10 minutes')
    expect(cueText(1371, 400_000, null)).toBe('1.37 kilometres, 6 minutes 40 seconds')
  })

  it('includes hours and omits an unknown pace', () => {
    expect(cueText(10_000, 3_725_000, null)).toBe('10 kilometres, 1 hour 2 minutes 5 seconds')
  })

  it('leaves out a pace slower than walking noise', () => {
    expect(cueText(1000, 300_000, 4000)).not.toContain('pace')
  })
})

describe('nextCue', () => {
  it('is silent before the first threshold', () => {
    const state = initCueState(0, 0, km)
    expect(nextCue(state, 999, 300_000, km)).toBeNull()
  })

  it('speaks at each km with the pace of that km', () => {
    let state = initCueState(0, 0, km)
    const first = nextCue(state, 1001, 330_000, km)!
    expect(first.text).toContain('1 kilometre, 5 minutes 30 seconds')
    expect(first.text).toContain('pace 5 minutes 30 seconds')
    state = first.state
    expect(nextCue(state, 1900, 600_000, km)).toBeNull()
    const second = nextCue(state, 2005, 640_000, km)!
    expect(second.text).toContain('2 kilometres')
    // 1004 m in 310 s
    expect(second.text).toContain('pace 5 minutes 9 seconds')
  })

  it('speaks one cue when several thresholds are crossed at once', () => {
    const state = initCueState(0, 0, km)
    const cue = nextCue(state, 3200, 900_000, km)!
    expect(cue.state.nextDistanceM).toBe(4000)
    expect(nextCue(cue.state, 3300, 910_000, km)).toBeNull()
  })

  it('speaks on time and combines with distance in one cue', () => {
    const state = initCueState(0, 0, both)
    const byTime = nextCue(state, 800, 5 * MIN, both)!
    expect(byTime.text).toContain('5 minutes')
    expect(byTime.state.nextElapsedMs).toBe(10 * MIN)
    expect(byTime.state.nextDistanceM).toBe(1000)
    const together = nextCue(byTime.state, 1500, 10 * MIN, both)!
    expect(together.state.nextDistanceM).toBe(2000)
  })

  it('does nothing when both triggers are off', () => {
    const off: CueConfig = { distanceKm: 0, timeMin: 0 }
    expect(nextCue(initCueState(0, 0, off), 50_000, 99 * MIN, off)).toBeNull()
  })

  it('omits the pace when the interval is too short to trust', () => {
    const state = initCueState(990, 300_000, both)
    const cue = nextCue(state, 1010, 5 * MIN + 1, both)!
    expect(cue.text).not.toContain('pace')
  })

  it('does not repeat a cue for a run seen at 3 km (recovered)', () => {
    const state = initCueState(3200, 900_000, km)
    expect(nextCue(state, 3300, 930_000, km)).toBeNull()
    expect(nextCue(state, 4001, 1_200_000, km)).not.toBeNull()
  })

  it('retargets to the new config without a burst of cues', () => {
    const state = initCueState(0, 0, km)
    const moved = retargetCueState(state, 2300, 700_000, { distanceKm: 2, timeMin: 0 })
    expect(moved.nextDistanceM).toBe(4000)
    expect(moved.lastDistanceM).toBe(0)
  })
})
