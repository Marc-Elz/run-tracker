import { describe, expect, it } from 'vitest'
import { createMemoryRunRepository } from '../memoryRunRepository'
import { serialized, unavailableRunRepository, type RunRecord } from '../runRepository'

const runRecord = (
  id: string,
  startedAt: number,
  status: RunRecord['status'] = 'running',
): RunRecord => ({
  id,
  name: null,
  status,
  startedAt,
  finishedAt: null,
  elapsedMs: 0,
  segment: 0,
  segmentStartedAt: startedAt,
  movingMs: 0,
  distanceM: 0,
  sessionId: null,
})

describe('memory run repository', () => {
  it('keeps points with their segment and optional fields', async () => {
    const repo = createMemoryRunRepository()
    await repo.createRun(runRecord('a', 0))
    await repo.addPoint('a', 0, { lat: 52, lon: 4, timestamp: 1, accuracy: 30 })
    await repo.addPoint('a', 1, { lat: 52, lon: 4, timestamp: 2, altitude: 3, speed: 2.5 })
    expect(await repo.loadPoints('a')).toEqual([
      { lat: 52, lon: 4, timestamp: 1, accuracy: 30, segment: 0 },
      { lat: 52, lon: 4, timestamp: 2, altitude: 3, speed: 2.5, segment: 1 },
    ])
  })

  it('lists unfinished runs newest first', async () => {
    const repo = createMemoryRunRepository()
    await repo.createRun(runRecord('old', 0))
    await repo.createRun(runRecord('done', 5, 'finished'))
    await repo.createRun(runRecord('new', 10))
    expect((await repo.findUnfinished()).map((r) => r.id)).toEqual(['new', 'old'])
  })

  it('gets one run, or null, and lists finished runs newest first', async () => {
    const repo = createMemoryRunRepository()
    await repo.createRun(runRecord('old', 0, 'finished'))
    await repo.createRun(runRecord('active', 5))
    await repo.createRun(runRecord('new', 10, 'finished'))
    expect((await repo.getRun('old'))?.id).toBe('old')
    expect(await repo.getRun('nope')).toBeNull()
    expect((await repo.listFinished()).map((r) => r.id)).toEqual(['new', 'old'])
  })

  it('renames a run, keeps the name through updates and clears it with null', async () => {
    const repo = createMemoryRunRepository()
    await repo.createRun(runRecord('a', 0, 'finished'))
    await repo.renameRun('a', 'Morning loop')
    expect((await repo.getRun('a'))?.name).toBe('Morning loop')

    await repo.updateRun(runRecord('a', 0, 'finished'))
    expect((await repo.getRun('a'))?.name).toBe('Morning loop')

    await repo.renameRun('a', null)
    expect((await repo.getRun('a'))?.name).toBeNull()
    await expect(repo.renameRun('nope', 'x')).rejects.toThrow('not found')
  })

  it('links several runs to one session, and none for a free run (#116)', async () => {
    const repo = createMemoryRunRepository()
    expect(await repo.createRun({ ...runRecord('a', 0), sessionId: 's' })).toBe('s')
    expect(await repo.createRun({ ...runRecord('b', 1), sessionId: 's' })).toBe('s')
    expect(await repo.importRun({ ...runRecord('c', 2, 'finished'), sessionId: 's' }, [])).toBe(
      true,
    )
    expect((await repo.getRun('c'))?.sessionId).toBe('s')
    expect(await repo.createRun(runRecord('free', 3))).toBeNull()
  })

  it('links a saved run to a session afterwards, and unlinks it (#102)', async () => {
    const repo = createMemoryRunRepository()
    await repo.createRun(runRecord('a', 0, 'finished'))
    expect(await repo.setRunSession('a', 's')).toBe('s')
    expect((await repo.getRun('a'))?.sessionId).toBe('s')
    expect(await repo.doneSessionIds()).toEqual(['s'])
    expect(await repo.setRunSession('a', null)).toBeNull()
    expect(await repo.doneSessionIds()).toEqual([])
    await expect(repo.setRunSession('nope', 's')).rejects.toThrow('not found')
  })

  it('counts a session done once its run is finished, and never changes the link on update', async () => {
    const repo = createMemoryRunRepository()
    await repo.createRun({ ...runRecord('a', 0), sessionId: 's' })
    expect(await repo.doneSessionIds()).toEqual([])
    await repo.updateRun(runRecord('a', 0, 'finished'))
    expect((await repo.getRun('a'))?.sessionId).toBe('s')
    expect(await repo.doneSessionIds()).toEqual(['s'])
    await repo.deleteRun('a')
    expect(await repo.doneSessionIds()).toEqual([])
  })

  it('lists a session once however many finished runs it has (#116)', async () => {
    const repo = createMemoryRunRepository()
    await repo.createRun({ ...runRecord('a', 0, 'finished'), sessionId: 's' })
    await repo.createRun({ ...runRecord('b', 1, 'finished'), sessionId: 's' })
    expect(await repo.doneSessionIds()).toEqual(['s'])
  })

  it('deletes a run with its points', async () => {
    const repo = createMemoryRunRepository()
    await repo.createRun(runRecord('a', 0))
    await repo.addPoint('a', 0, { lat: 52, lon: 4, timestamp: 1 })
    await repo.deleteRun('a')
    expect(await repo.findUnfinished()).toEqual([])
    expect(await repo.loadPoints('a')).toEqual([])
  })
})

describe('serialized', () => {
  it('runs each call after the previous one, even when an earlier one fails', async () => {
    const order: string[] = []
    const inner = createMemoryRunRepository()
    const slow = {
      ...inner,
      async createRun(run: RunRecord) {
        await new Promise((r) => setTimeout(r, 10))
        order.push('create')
        return inner.createRun(run)
      },
      async addPoint(...args: Parameters<typeof inner.addPoint>) {
        order.push('point')
        return inner.addPoint(...args)
      },
    }
    const repo = serialized(slow)
    const failing = repo.updateRun(runRecord('missing', 0))
    const create = repo.createRun(runRecord('a', 0))
    const point = repo.addPoint('a', 0, { lat: 52, lon: 4, timestamp: 1 })
    await expect(failing).rejects.toThrow('not found')
    await Promise.all([create, point])
    expect(order).toEqual(['create', 'point'])
  })
})

describe('unavailable repository', () => {
  it('rejects every call', async () => {
    const repo = unavailableRunRepository(new Error('no plugin'))
    await expect(repo.createRun(runRecord('a', 0))).rejects.toThrow('Database unavailable')
    await expect(repo.findUnfinished()).rejects.toThrow('Database unavailable')
    await expect(repo.getRun('a')).rejects.toThrow('Database unavailable')
    await expect(repo.listFinished()).rejects.toThrow('Database unavailable')
  })
})

describe('importRun', () => {
  const finished = (id: string) => ({
    ...runRecord(id, 0, 'finished'),
    name: 'Haren',
    finishedAt: 9,
  })
  const pts = [
    { segment: 0, timestamp: 5, lat: 1, lon: 2 },
    { segment: 0, timestamp: 5, lat: 3, lon: 4, accuracy: 6 },
    { segment: 1, timestamp: 2, lat: 5, lon: 6 },
  ]

  it('stores the run with its name and the points in the given order', async () => {
    const repo = createMemoryRunRepository()
    expect(await repo.importRun(finished('a'), pts)).toBe(true)
    expect(await repo.getRun('a')).toEqual(finished('a'))
    expect(await repo.loadPoints('a')).toEqual(pts)
    expect((await repo.listFinished()).map((r) => r.id)).toEqual(['a'])
  })

  it('writes nothing and returns false when the id already exists', async () => {
    const repo = createMemoryRunRepository()
    await repo.importRun(finished('a'), pts)
    expect(await repo.importRun({ ...finished('a'), name: 'Other' }, [])).toBe(false)
    expect((await repo.getRun('a'))?.name).toBe('Haren')
    expect(await repo.loadPoints('a')).toEqual(pts)
  })

  it('goes through the write queue and fails when the database is unavailable', async () => {
    const calls: string[] = []
    const inner = createMemoryRunRepository()
    const queued = serialized({
      ...inner,
      importRun: async (run, points) => {
        calls.push(run.id)
        return inner.importRun(run, points)
      },
    })
    expect(await queued.importRun(finished('a'), [])).toBe(true)
    expect(calls).toEqual(['a'])
    await expect(unavailableRunRepository('x').importRun(finished('a'), [])).rejects.toThrow(
      /unavailable/,
    )
  })
})
