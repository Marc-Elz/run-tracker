import { describe, expect, it } from 'vitest'
import { createMemoryRunRepository } from '../memoryRunRepository'
import { serialized, unavailableRunRepository, type RunRecord } from '../runRepository'

const runRecord = (
  id: string,
  startedAt: number,
  status: RunRecord['status'] = 'running',
): RunRecord => ({
  id,
  status,
  startedAt,
  finishedAt: null,
  elapsedMs: 0,
  segment: 0,
  segmentStartedAt: startedAt,
  movingMs: 0,
  distanceM: 0,
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
  })
})
