import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useRunStore } from '../run'

// ~0.001 degrees of latitude is ~111 m
const at = (t: number, latOffset: number) => ({ lat: 52 + latOffset, lon: 4, timestamp: t })

describe('run store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })
  afterEach(() => vi.useRealTimers())

  it('starts idle', () => {
    expect(useRunStore().status).toBe('idle')
  })

  it('excludes paused time from elapsed time', () => {
    const run = useRunStore()
    run.start(0)
    run.pause(10_000)
    run.tick(70_000) // a minute passes while paused
    expect(run.elapsedMs).toBe(10_000)
    run.resume(70_000)
    run.tick(75_000)
    expect(run.elapsedMs).toBe(15_000)
  })

  it('accumulates distance between points while running', () => {
    const run = useRunStore()
    run.start(0)
    run.addPoint(at(1000, 0))
    run.addPoint(at(2000, 0.001))
    expect(run.distanceM).toBeGreaterThan(105)
    expect(run.distanceM).toBeLessThan(115)
  })

  it('ignores points when not running', () => {
    const run = useRunStore()
    run.addPoint(at(0, 0))
    run.start(0)
    run.pause(1000)
    run.addPoint(at(2000, 0))
    expect(run.points).toHaveLength(0)
  })

  it('does not count the distance travelled during a pause', () => {
    const run = useRunStore()
    run.start(0)
    run.addPoint(at(1000, 0))
    run.pause(2000)
    run.resume(60_000)
    run.addPoint(at(61_000, 0.01)) // ~1.1 km away, moved while paused
    expect(run.distanceM).toBe(0)
  })

  it('has no pace until enough distance is covered', () => {
    const run = useRunStore()
    run.start(0)
    run.addPoint(at(1000, 0))
    run.tick(2000)
    expect(run.averagePaceSecPerKm).toBeNull()
    expect(run.currentPaceSecPerKm).toBeNull()
  })

  it('computes average and current pace', () => {
    const run = useRunStore()
    run.start(0)
    // 111 m every 30 s -> ~270 s/km
    for (let i = 0; i <= 4; i++) run.addPoint(at(i * 30_000, i * 0.001))
    run.tick(120_000)
    expect(run.averagePaceSecPerKm).toBeCloseTo(270, -1)
    // Current pace looks at the last 20 s only; with 30 s between fixes only one point qualifies
    expect(run.currentPaceSecPerKm).toBeNull()
    run.addPoint(at(130_000, 0.0042))
    run.tick(131_000)
    expect(run.currentPaceSecPerKm).not.toBeNull()
  })

  it('does not bridge a pause in the current pace window', () => {
    const run = useRunStore()
    run.start(0)
    run.addPoint(at(1000, 0))
    run.pause(2000)
    run.resume(5000)
    run.addPoint(at(6000, 0.05)) // far away: must not feed the pace window with the old point
    run.tick(7000)
    expect(run.currentPaceSecPerKm).toBeNull()
  })

  it('moves paused -> finished on stop and resets to idle', () => {
    const run = useRunStore()
    run.start(0)
    run.stop(5000)
    expect(run.status).toBe('finished')
    expect(run.elapsedMs).toBe(5000)
    run.reset()
    expect(run.status).toBe('idle')
    expect(run.elapsedMs).toBe(0)
  })

  it('ticks the clock while running', () => {
    const run = useRunStore()
    run.start(Date.now())
    vi.advanceTimersByTime(3000)
    expect(run.elapsedMs).toBeGreaterThanOrEqual(3000)
  })
})
