import { describe, expect, it } from 'vitest'
import type { RunPause } from '@/lib/runPauses'
import { createMemoryRunRepository } from '../memoryRunRepository'
import { createSqliteRunRepository } from '../sqliteRunRepository'
import { migrate } from '../migrations'
import type { RunRecord, RunRepository } from '../runRepository'
import { nodeSqlite, openTestDb } from './nodeSqlite'

const run = (id: string, over: Partial<RunRecord> = {}): RunRecord => ({
  id,
  name: null,
  status: 'running',
  startedAt: 1,
  finishedAt: null,
  elapsedMs: 0,
  segment: 0,
  segmentStartedAt: 1,
  movingMs: 0,
  distanceM: 0,
  sessionId: null,
  ...over,
})

const pause = (position: number, over: Partial<RunPause> = {}): RunPause => ({
  position,
  kind: 'auto',
  startedAt: 100_000 + position * 60_000,
  endedAt: null,
  startedElapsedMs: position * 50_000,
  lat: 52.1,
  lon: 4.2,
  ...over,
})

const implementations: [string, () => Promise<RunRepository>][] = [
  ['memory', async () => createMemoryRunRepository()],
]
if (nodeSqlite) {
  implementations.push([
    'sqlite',
    async () => {
      const db = openTestDb()
      await migrate(db)
      return createSqliteRunRepository(db)
    },
  ])
}

describe.each(implementations)('%s run pauses (#154)', (_name, open) => {
  it('stores an open pause, then closes it in place', async () => {
    const repo = await open()
    await repo.createRun(run('r'))
    await repo.savePause('r', pause(0))
    expect(await repo.loadPauses('r')).toEqual([pause(0)])
    await repo.savePause('r', pause(0, { endedAt: 130_000 }))
    expect(await repo.loadPauses('r')).toEqual([pause(0, { endedAt: 130_000 })])
  })

  it('keeps pauses in order, without a spot when the run had no fix', async () => {
    const repo = await open()
    await repo.createRun(run('r'))
    await repo.savePause('r', pause(1, { lat: null, lon: null }))
    await repo.savePause('r', pause(0, { endedAt: 110_000 }))
    expect(await repo.loadPauses('r')).toEqual([
      pause(0, { endedAt: 110_000 }),
      pause(1, { lat: null, lon: null }),
    ])
    expect(await repo.loadPauses('other')).toEqual([])
  })

  it('deletes the pauses with the run', async () => {
    const repo = await open()
    await repo.createRun(run('r'))
    await repo.savePause('r', pause(0))
    await repo.deleteRun('r')
    expect(await repo.loadPauses('r')).toEqual([])
  })

  it('imports a run with its pauses, and without any', async () => {
    const repo = await open()
    const finished = { status: 'finished' as const, finishedAt: 500_000, segmentStartedAt: null }
    const pauses = [pause(0, { endedAt: 110_000 }), pause(1, { endedAt: 175_000 })]
    expect(await repo.importRun(run('a', finished), [], [], pauses)).toBe(true)
    expect(await repo.loadPauses('a')).toEqual(pauses)
    expect(await repo.importRun(run('b', finished), [])).toBe(true)
    expect(await repo.loadPauses('b')).toEqual([])
  })
})
