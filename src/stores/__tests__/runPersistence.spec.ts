import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useRunStore } from '../run'
import { createMemoryRunRepository } from '@/lib/db/memoryRunRepository'
import { unavailableRunRepository, type RunRepository } from '@/lib/db/runRepository'

// ~0.001 degrees of latitude is ~111 m
const at = (t: number, latOffset: number) => ({ lat: 52 + latOffset, lon: 4, timestamp: t })

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('run store persistence', () => {
  let repo: RunRepository

  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    repo = createMemoryRunRepository()
  })
  afterEach(() => vi.useRealTimers())

  function store() {
    const run = useRunStore()
    run.useRepository(repo)
    return run
  }

  /** A new app launch on the same database */
  function relaunch() {
    setActivePinia(createPinia())
    return store()
  }

  it('saves the run with a UUID and every raw fix with its segment', async () => {
    const run = store()
    run.start(1_000)
    run.addPoint(at(2_000, 0))
    run.addPoint({ ...at(3_000, 0.0005), accuracy: 80, altitude: 4, speed: 3 }) // inaccurate
    run.pause(4_000)
    run.resume(10_000)
    run.addPoint(at(11_000, 0.001))

    expect(run.runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    const [saved] = await repo.findUnfinished()
    expect(saved).toMatchObject({
      id: run.runId,
      status: 'running',
      startedAt: 1_000,
      elapsedMs: 3_000,
      segment: 1,
      segmentStartedAt: 10_000,
    })
    const points = await repo.loadPoints(run.runId!)
    expect(points.map((p) => p.segment)).toEqual([0, 0, 1])
    expect(points[1]).toMatchObject({ accuracy: 80, altitude: 4, speed: 3 })
  })

  it('saves the run as finished with its totals on stop', async () => {
    const run = store()
    run.start(0)
    run.addPoint(at(0, 0))
    run.addPoint(at(30_000, 0.001))
    run.stop(40_000)
    expect(await repo.findUnfinished()).toEqual([])
    run.reset()
    expect(run.runId).toBeNull()
  })

  it('discard deletes the run and its points', async () => {
    const run = store()
    run.start(0)
    run.addPoint(at(0, 0))
    const id = run.runId!
    run.stop(5_000)
    run.discard()
    expect(run.status).toBe('idle')
    expect(await repo.loadPoints(id)).toEqual([])
  })

  it('recovers a run killed mid-segment as paused, with totals from the raw points', async () => {
    const run = store()
    run.start(0)
    run.addPoint(at(0, 0))
    run.addPoint(at(30_000, 0.001))
    run.addPoint(at(60_000, 0.002))
    const { distanceM, movingMs, runId } = run
    // App killed here, 60 s after start; relaunched later

    const again = relaunch()
    vi.setSystemTime(500_000)
    await again.recover()
    expect(again.status).toBe('paused')
    expect(again.recovered).toBe(true)
    expect(again.runId).toBe(runId)
    expect(again.distanceM).toBeCloseTo(distanceM, 6)
    expect(again.movingMs).toBe(movingMs)
    expect(again.elapsedMs).toBe(60_000) // up to the last fix, not the time the app was dead
    expect(await repo.findUnfinished()).toEqual([
      expect.objectContaining({ status: 'paused', elapsedMs: 60_000, segmentStartedAt: null }),
    ])
  })

  it('recovers a run killed while paused with its banked time', async () => {
    const run = store()
    run.start(0)
    run.addPoint(at(1_000, 0))
    run.pause(20_000)

    const again = relaunch()
    await again.recover()
    expect(again.elapsedMs).toBe(20_000)
  })

  it('does not count the gap between the kill and Resume as distance', async () => {
    const run = store()
    run.start(0)
    run.addPoint(at(0, 0))
    run.addPoint(at(30_000, 0.001))
    const before = run.distanceM

    const again = relaunch()
    await again.recover()
    again.resume(600_000)
    // Ten minutes later, ~1.1 km away (walked home): first fix of the new segment
    again.addPoint(at(601_000, 0.011))
    expect(again.distanceM).toBeCloseTo(before, 6)
    expect(again.recovered).toBe(false)
  })

  it('resumes at a fresh segment index when a segment had no fixes', async () => {
    const run = store()
    run.start(0)
    run.addPoint(at(0, 0))
    run.pause(1_000)
    run.resume(2_000) // segment 1: no fixes
    run.pause(3_000)
    run.resume(4_000) // segment 2
    run.addPoint(at(5_000, 0.001))

    const again = relaunch()
    await again.recover()
    expect(again.segments.map((s) => s.length)).toEqual([1, 0, 1])
    again.resume(10_000)
    again.addPoint(at(11_000, 0.05))
    const points = await repo.loadPoints(again.runId!)
    expect(points.map((p) => p.segment)).toEqual([0, 2, 3])
  })

  it('recovers only the newest unfinished run and finishes older ones with their totals', async () => {
    const first = store()
    first.start(0)
    first.addPoint(at(0, 0))
    first.addPoint(at(30_000, 0.001))
    const oldId = first.runId!

    const second = relaunch()
    second.start(100_000)
    const newId = second.runId!

    const third = relaunch()
    await third.recover()
    expect(third.runId).toBe(newId)
    expect((await repo.findUnfinished()).map((r) => r.id)).toEqual([newId])
    third.discard()
    expect(await repo.loadPoints(oldId)).toHaveLength(2) // older run kept, finished
  })

  it('recovers nothing when every run was finished', async () => {
    const run = store()
    run.start(0)
    run.stop(1_000)
    const again = relaunch()
    await again.recover()
    expect(again.status).toBe('idle')
  })

  it('keeps running and flags it when saving fails', async () => {
    const run = useRunStore()
    run.useRepository(unavailableRunRepository(new Error('no database')))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    run.start(0)
    run.addPoint(at(0, 0))
    await settle()
    expect(run.status).toBe('running')
    expect(run.points).toHaveLength(1)
    expect(run.saveError).toBe(true)
    run.discard()
    expect(run.saveError).toBe(false)
  })
})
