import { describe, expect, it, vi } from 'vitest'
import { createMemoryRunRepository } from '@/lib/db/memoryRunRepository'
import type { RunRecord } from '@/lib/db/runRepository'
import { buildOverview, loadRouteOverviews, OVERVIEW_ALGO } from '../routeOverview'

const run = (
  id: string,
  startedAt: number,
  segment = 0,
  status: RunRecord['status'] = 'finished',
): RunRecord => ({
  id,
  name: null,
  status,
  startedAt,
  finishedAt: status === 'finished' ? startedAt + 1 : null,
  elapsedMs: 0,
  segment,
  segmentStartedAt: null,
  movingMs: 0,
  distanceM: 0,
  sessionId: null,
})

// A straight run north: a fix every ~11 m, ten seconds apart (a believable pace)
const straight = (segment: number, n: number, lon = 4) =>
  Array.from({ length: n }, (_, i) => ({
    segment,
    lat: 52 + i * 0.0001,
    lon,
    timestamp: 1_000_000 + segment * 1_000_000 + i * 10_000,
  }))

async function seed(
  repo = createMemoryRunRepository(),
  id = 'a',
  startedAt = 1,
  points = straight(0, 30),
) {
  await repo.createRun(run(id, startedAt))
  for (const { segment, ...p } of points) await repo.addPoint(id, segment, p)
  return repo
}

describe('buildOverview', () => {
  it('reduces a straight run to its two ends and records the bounds', () => {
    const o = buildOverview(run('a', 1), straight(0, 30))
    expect(o.algo).toBe(OVERVIEW_ALGO)
    expect(o.lines).toHaveLength(1)
    expect(o.lines[0]).toHaveLength(2)
    expect(o.bounds).toEqual([4, 52, 4, 52 + 29 * 0.0001])
  })

  it('keeps each segment as its own line so a pause gap is never joined', () => {
    const o = buildOverview(run('a', 1, 1), [...straight(0, 10), ...straight(1, 10, 4.01)])
    expect(o.lines).toHaveLength(2)
  })

  it('gives empty lines and no bounds for a run without a drawable route', () => {
    expect(buildOverview(run('a', 1), [])).toMatchObject({ lines: [], bounds: null })
    expect(buildOverview(run('a', 1), straight(0, 1))).toMatchObject({ lines: [], bounds: null })
  })

  it('leaves out inaccurate fixes, like the run summary does', () => {
    const points = straight(0, 10).map((p, i) => (i === 5 ? { ...p, lon: 5, accuracy: 100 } : p))
    expect(buildOverview(run('a', 1), points).bounds).toEqual([4, 52, 4, 52 + 9 * 0.0001])
  })
})

describe('loadRouteOverviews', () => {
  it('builds missing overviews once and reads them from the store afterwards', async () => {
    const repo = await seed()
    const loadPoints = vi.spyOn(repo, 'loadPoints')
    const first = await loadRouteOverviews(repo)
    expect(first.overviews.map((o) => o.runId)).toEqual(['a'])
    expect(loadPoints).toHaveBeenCalledTimes(1)

    const second = await loadRouteOverviews(repo)
    expect(second.overviews).toEqual(first.overviews)
    expect(loadPoints).toHaveBeenCalledTimes(1)
  })

  it('rebuilds an overview stored by an older algorithm', async () => {
    const repo = await seed()
    await repo.saveOverview({ runId: 'a', algo: OVERVIEW_ALGO - 1, lines: [], bounds: null })
    const { overviews } = await loadRouteOverviews(repo)
    expect(overviews[0]!.algo).toBe(OVERVIEW_ALGO)
    expect(overviews[0]!.lines).toHaveLength(1)
  })

  it('picks up imported runs without any extra step and returns runs newest first', async () => {
    const repo = await seed(undefined, 'old', 1)
    await loadRouteOverviews(repo)
    await repo.importRun(run('imported', 5), straight(0, 20))
    const { runs, overviews } = await loadRouteOverviews(repo)
    expect(runs.map((r) => r.id)).toEqual(['imported', 'old'])
    expect(overviews.map((o) => o.runId)).toEqual(['imported', 'old'])
  })

  it('drops the overview of a deleted run', async () => {
    const repo = await seed()
    await loadRouteOverviews(repo)
    await repo.deleteRun('a')
    expect(await repo.readOverviews()).toEqual([])
    expect((await loadRouteOverviews(repo)).overviews).toEqual([])
  })

  it('does not include unfinished runs', async () => {
    const repo = await seed()
    await loadRouteOverviews(repo)
    await repo.createRun(run('live', 9, 0, 'running'))
    await repo.saveOverview({ runId: 'live', algo: OVERVIEW_ALGO, lines: [], bounds: null })
    expect((await loadRouteOverviews(repo)).overviews.map((o) => o.runId)).toEqual(['a'])
  })

  it('skips a run that fails to build, counts it and tries it again next time', async () => {
    const repo = await seed()
    await seed(repo, 'b', 2)
    vi.spyOn(repo, 'loadPoints').mockRejectedValueOnce(new Error('disk'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = await loadRouteOverviews(repo)
    expect(first.failed).toBe(1)
    expect(first.overviews).toHaveLength(1)
    const second = await loadRouteOverviews(repo)
    expect(second.failed).toBe(0)
    expect(second.overviews).toHaveLength(2)
  })

  it('reports progress in batches for the runs it has to build', async () => {
    const repo = createMemoryRunRepository()
    for (let i = 0; i < 25; i++) await seed(repo, `r${i}`, i, straight(0, 5))
    const progress: [number, number][] = []
    await loadRouteOverviews(repo, (done, total) => progress.push([done, total]))
    expect(progress).toEqual([
      [10, 25],
      [20, 25],
      [25, 25],
    ])
    progress.length = 0
    await loadRouteOverviews(repo, (done, total) => progress.push([done, total]))
    expect(progress).toEqual([])
  })

  it('handles hundreds of runs, reading raw points only on the first load', async () => {
    const repo = createMemoryRunRepository()
    for (let i = 0; i < 300; i++) await seed(repo, `r${i}`, i, straight(0, 200))
    const loadPoints = vi.spyOn(repo, 'loadPoints')
    expect((await loadRouteOverviews(repo)).overviews).toHaveLength(300)
    expect(loadPoints).toHaveBeenCalledTimes(300)
    expect((await loadRouteOverviews(repo)).overviews).toHaveLength(300)
    expect(loadPoints).toHaveBeenCalledTimes(300)
  })
})
