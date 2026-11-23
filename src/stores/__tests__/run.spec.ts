import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useRunStore } from '../run'
import { summarizeTrack } from '@/lib/runStats'
import { createMemoryRunRepository } from '@/lib/db/memoryRunRepository'
import { MAX_RUN_NAME_LENGTH } from '@/lib/format'

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
    run.addPoint(at(31_000, 0.001))
    expect(run.distanceM).toBeGreaterThan(105)
    expect(run.distanceM).toBeLessThan(115)
  })

  it('brings the clock up to a counted fix, between the timer ticks', () => {
    vi.setSystemTime(0)
    const run = useRunStore()
    run.start(0)
    vi.setSystemTime(1400)
    run.addPoint(at(1400, 0))
    expect(run.elapsedMs).toBe(1400)
    vi.setSystemTime(2700)
    run.addPoint(at(2700, 0.00001)) // ~1 m: jitter, not counted, so the clock waits for its tick
    expect(run.elapsedMs).toBe(1400)
  })

  it('stores filtered fixes but leaves them out of distance and moving time', () => {
    const run = useRunStore()
    run.start(0)
    run.addPoint(at(1000, 0))
    run.addPoint({ ...at(16_000, 0.0005), accuracy: 60 }) // inaccurate
    run.addPoint(at(17_000, 0.05)) // jump of ~5.5 km
    run.addPoint(at(31_000, 0.001))
    expect(run.points).toHaveLength(4)
    expect(run.distanceM).toBeCloseTo(111, -1)
    expect(run.movingMs).toBe(30_000)
  })

  it('reports moving time and moving pace apart from elapsed time and pace', () => {
    const run = useRunStore()
    run.start(0)
    run.addPoint(at(0, 0))
    run.addPoint(at(30_000, 0.001)) // ~111 m in 30 s
    run.addPoint(at(150_000, 0.0011)) // ~11 m in 2 min: waiting at a crossing
    run.addPoint(at(180_000, 0.0021))
    run.tick(180_000)
    expect(run.elapsedMs).toBe(180_000)
    expect(run.movingMs).toBe(60_000)
    expect(run.averagePaceSecPerKm).toBeCloseTo(180 / 0.2335, -1)
    expect(run.averageMovingPaceSecPerKm).toBeCloseTo(60 / 0.2335, -1)
  })

  it('matches summarizeTrack on the stored segments', () => {
    const run = useRunStore()
    run.start(0)
    for (let i = 0; i <= 5; i++) run.addPoint(at(i * 30_000, i * 0.001))
    run.pause(160_000)
    run.resume(200_000)
    for (let i = 0; i <= 5; i++) run.addPoint(at(200_000 + i * 30_000, 0.02 + i * 0.001))
    expect(run.segments).toHaveLength(2)
    expect(summarizeTrack(run.segments)).toEqual({
      distanceM: run.distanceM,
      movingMs: run.movingMs,
    })
  })

  it('matches summarizeTrack after a bad first fix is overruled (#178)', () => {
    vi.setSystemTime(0)
    const run = useRunStore()
    run.start(0)
    run.addPoint(at(0, 0.00158)) // 176 m off
    for (let i = 1; i <= 8; i++) run.addPoint(at(i * 4000, (i - 1) * 0.0001))
    run.tick(32_000)
    expect(run.distanceM).toBeCloseTo(7 * 11.12, 0)
    // 11 m per 4 s over the last 20 s: the bad fix no longer holds the pace back
    expect(run.currentPaceSecPerKm).toBeCloseTo(4 / 0.01112, -1)
    expect(summarizeTrack(run.segments)).toEqual({
      distanceM: run.distanceM,
      movingMs: run.movingMs,
    })
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

  describe('renaming a saved run', () => {
    async function saved() {
      const repo = createMemoryRunRepository()
      const run = useRunStore()
      run.useRepository(repo)
      run.start(0)
      const id = await run.finish(5000)
      return { run, repo, id: id! }
    }

    it('stores a trimmed name and returns it', async () => {
      const { run, repo, id } = await saved()
      expect(await run.renameRun(id, '  Morning loop ')).toBe('Morning loop')
      expect((await repo.getRun(id))?.name).toBe('Morning loop')
    })

    it('clears the name when blank', async () => {
      const { run, repo, id } = await saved()
      await run.renameRun(id, 'Morning loop')
      expect(await run.renameRun(id, '   ')).toBeNull()
      expect((await repo.getRun(id))?.name).toBeNull()
    })

    it('cuts a name to the longest allowed', async () => {
      const { run, id } = await saved()
      expect(await run.renameRun(id, 'x'.repeat(100))).toHaveLength(MAX_RUN_NAME_LENGTH)
    })
  })

  describe('auto-pause (#154)', () => {
    /** Ran 33 m by 10 s, auto-paused at 14 s */
    function autoPaused() {
      vi.setSystemTime(0)
      const run = useRunStore()
      run.start(0)
      run.addPoint(at(1000, 0))
      run.addPoint(at(10_000, 0.0003))
      run.autoPause(14_000)
      return run
    }

    it('pauses like the Pause button, marked as auto', () => {
      const run = autoPaused()
      run.tick(60_000)
      expect(run.status).toBe('paused')
      expect(run.pauseKind).toBe('auto')
      expect(run.elapsedMs).toBe(14_000)
    })

    it('resumes from the first moving fix: drift dropped, the metres of the resume kept', () => {
      const run = autoPaused()
      const before = run.distanceM
      run.addPoint(at(20_000, 0.0006)) // drift while standing, 33 m off
      for (let s = 0; s <= 3; s++) run.addPoint(at(30_000 + s * 1000, 0.0003 + s * 0.00003))
      vi.setSystemTime(33_500)
      run.autoResume(30_000, 33_500)

      expect(run.status).toBe('running')
      expect(run.pauseKind).toBeNull()
      // 14 s before the pause, then from the first moving fix (30 s) to now
      expect(run.elapsedMs).toBe(17_500)
      expect(run.segments).toHaveLength(2)
      expect(run.segments[1]).toHaveLength(4)
      // 10 m on from where it stopped, counted in steps of 5 m or more (so 6.7 m here); the
      // drift fix would have added 66 m
      expect(run.distanceM - before).toBeGreaterThan(5)
      expect(run.distanceM - before).toBeLessThan(12)
    })

    it('never moves elapsed time backwards when the GPS clock is behind or ahead', () => {
      const behind = autoPaused()
      behind.autoResume(5_000, 20_000) // GPS time before the pause
      expect(behind.elapsedMs).toBe(14_000 + 6_000)

      setActivePinia(createPinia())
      const ahead = autoPaused()
      ahead.autoResume(90_000, 20_000) // GPS time after now
      expect(ahead.elapsedMs).toBe(14_000)
    })

    it('Pause during an auto-pause holds it: no resume by itself, nothing held back', () => {
      const run = autoPaused()
      run.holdPause()
      expect(run.pauseKind).toBe('manual')
      run.addPoint(at(30_000, 0.0004))
      run.autoResume(30_000, 33_000)
      expect(run.status).toBe('paused')
      run.resume(40_000)
      expect(run.segments[1]).toEqual([])
    })

    it('Resume during an auto-pause resumes now and stores none of the held-back fixes', () => {
      const run = autoPaused()
      run.addPoint(at(20_000, 0.0004))
      run.resume(25_000)
      expect(run.pauseKind).toBeNull()
      expect(run.elapsedMs).toBe(14_000)
      expect(run.segments[1]).toEqual([])
    })

    it('pauses at the real spot when the first fix was 176 m off (#178)', () => {
      vi.setSystemTime(0)
      const run = useRunStore()
      run.start(0)
      run.addPoint({ ...at(1000, 0.00158), accuracy: 20 })
      for (const t of [1300, 2000, 3000, 4000, 10_000]) run.addPoint(at(t, 0))
      run.autoPause(14_000)
      expect(run.runPauses[0]).toMatchObject({ lat: 52, lon: 4 })
      expect(run.distanceM).toBe(0)
    })

    it('only auto-pauses a running run', () => {
      const run = useRunStore()
      run.start(0)
      run.pause(5000)
      run.autoPause(6000)
      expect(run.pauseKind).toBe('manual')
    })
  })

  it('ticks the clock while running', () => {
    const run = useRunStore()
    run.start(Date.now())
    vi.advanceTimersByTime(3000)
    expect(run.elapsedMs).toBeGreaterThanOrEqual(3000)
  })
})
