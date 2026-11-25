import { describe, expect, it } from 'vitest'
import { createMemoryRunRepository } from '../memoryRunRepository'
import { createSqliteRunRepository } from '../sqliteRunRepository'
import { MIGRATIONS, migrate } from '../migrations'
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
  recordingLostAt: null,
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

describe.each(implementations)('%s recording lost marker (#81)', (_name, open) => {
  it('starts unmarked, then stores and keeps the marker through updates', async () => {
    const repo = await open()
    await repo.createRun(run('a'))
    expect((await repo.getRun('a'))?.recordingLostAt).toBeNull()

    await repo.updateRun(run('a', { status: 'paused', recordingLostAt: 5_000 }))
    expect((await repo.getRun('a'))?.recordingLostAt).toBe(5_000)
    await repo.updateRun(
      run('a', { status: 'finished', finishedAt: 9_000, recordingLostAt: 5_000 }),
    )
    expect((await repo.listFinished())[0]?.recordingLostAt).toBe(5_000)
  })

  it('imports a run with and without the marker', async () => {
    const repo = await open()
    const done = { status: 'finished' as const, finishedAt: 2, segmentStartedAt: null }
    await repo.importRun(run('a', { ...done, recordingLostAt: 1_500 }), [])
    await repo.importRun(run('b', done), [])
    expect((await repo.getRun('a'))?.recordingLostAt).toBe(1_500)
    expect((await repo.getRun('b'))?.recordingLostAt).toBeNull()
  })
})

describe.skipIf(!nodeSqlite)('recording lost column on real SQLite', () => {
  it('adds the column on a phone at version 9, keeping every run unmarked', async () => {
    const db = openTestDb()
    for (const [i, sql] of MIGRATIONS.slice(0, 9).entries()) {
      await db.execute(`${sql}PRAGMA user_version = ${i + 1};\n`)
    }
    // Raw SQL: today's repository writes the column this schema doesn't have yet
    await db.run(
      `INSERT INTO runs (id, status, started_at, finished_at, elapsed_ms, segment, moving_ms,
        distance_m, created_at, updated_at) VALUES ('r', 'finished', 1, 2, 1, 0, 1, 10, 0, 0)`,
    )
    await db.run(
      `INSERT INTO track_points (run_id, segment, timestamp, lat, lon) VALUES ('r', 0, 1, 52, 4)`,
    )
    await db.run(
      `INSERT INTO run_pauses (run_id, position, kind, started_at, ended_at, started_elapsed_ms)
        VALUES ('r', 0, 'auto', 1, 2, 0)`,
    )

    expect(await migrate(db)).toBe(10)
    const runs = createSqliteRunRepository(db)
    expect(await runs.getRun('r')).toMatchObject({ id: 'r', distanceM: 10, recordingLostAt: null })
    expect(await runs.loadPoints('r')).toHaveLength(1)
    expect(await runs.loadPauses('r')).toHaveLength(1)
  })
})
