import { describe, expect, it } from 'vitest'
import type { RunStep } from '@/lib/stepProgress'
import { createMemoryRunRepository } from '../memoryRunRepository'
import { createSqliteRunRepository } from '../sqliteRunRepository'
import { createSqliteTrainingRepository } from '../sqliteTrainingRepository'
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
  ...over,
})

const runStep = (position: number, over: Partial<RunStep> = {}): RunStep => ({
  position,
  kind: 'run',
  targetKind: 'duration',
  targetValue: 60,
  paceMin: null,
  paceMax: null,
  repetition: null,
  repetitions: null,
  startedElapsedMs: position * 60_000,
  startedDistanceM: position * 150,
  endedElapsedMs: null,
  endedDistanceM: null,
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

describe.each(implementations)('%s run steps', (_name, open) => {
  it('stores started steps, then ends one and starts the next in one write', async () => {
    const repo = await open()
    await repo.createRun(run('r'))
    await repo.saveStepChange('r', null, [runStep(0, { kind: 'warmup', targetKind: 'none', targetValue: null })])
    const ended = runStep(0, {
      kind: 'warmup',
      targetKind: 'none',
      targetValue: null,
      endedElapsedMs: 300_000,
      endedDistanceM: 820.5,
    })
    const walk = runStep(1, {
      kind: 'walk',
      targetKind: 'distance',
      targetValue: 400,
      paceMin: 480,
      paceMax: 540,
      repetition: 2,
      repetitions: 6,
      startedElapsedMs: 300_000,
      startedDistanceM: 820.5,
    })
    await repo.saveStepChange('r', ended, [walk])
    expect(await repo.loadRunSteps('r')).toEqual([ended, walk])
  })

  it('keeps a started step that also ended in the same write', async () => {
    const repo = await open()
    await repo.createRun(run('r'))
    const done = runStep(0, { endedElapsedMs: 60_000, endedDistanceM: 150 })
    await repo.saveStepChange('r', null, [done, runStep(1)])
    expect(await repo.loadRunSteps('r')).toEqual([done, runStep(1)])
  })

  it('has no steps for a free run, and deletes them with the run', async () => {
    const repo = await open()
    await repo.createRun(run('r'))
    expect(await repo.loadRunSteps('r')).toEqual([])
    await repo.saveStepChange('r', null, [runStep(0)])
    await repo.deleteRun('r')
    expect(await repo.loadRunSteps('r')).toEqual([])
  })

  it('imports a run with its steps, and without', async () => {
    const repo = await open()
    const steps = [runStep(0, { endedElapsedMs: 60_000, endedDistanceM: 150 })]
    const finished = { status: 'finished' as const, finishedAt: 9, segmentStartedAt: null }
    expect(await repo.importRun(run('a', finished), [], steps)).toBe(true)
    expect(await repo.importRun(run('b', finished), [])).toBe(true)
    expect(await repo.loadRunSteps('a')).toEqual(steps)
    expect(await repo.loadRunSteps('b')).toEqual([])
  })
})

describe.skipIf(!nodeSqlite)('run steps on real SQLite', () => {
  it('writes nothing of a step change that fails halfway', async () => {
    const db = openTestDb()
    await migrate(db)
    const repo = createSqliteRunRepository(db)
    await repo.createRun(run('r'))
    await repo.saveStepChange('r', null, [runStep(0)])
    // Position 0 again: the insert fails, so the end of step 0 must not land either
    await expect(
      repo.saveStepChange('r', runStep(0, { endedElapsedMs: 60_000, endedDistanceM: 150 }), [
        runStep(0),
      ]),
    ).rejects.toThrow(/UNIQUE constraint failed/)
    expect(await repo.loadRunSteps('r')).toEqual([runStep(0)])
  })

  it('adds the run steps table on a phone with runs and programs, keeping every row', async () => {
    const db = openTestDb()
    for (const [i, sql] of MIGRATIONS.slice(0, 5).entries()) {
      await db.execute(`${sql}PRAGMA user_version = ${i + 1};\n`)
    }
    const training = createSqliteTrainingRepository(db)
    await training.createProgram({
      id: 'p',
      name: 'Plan',
      goal: null,
      weeks: 2,
      startDate: null,
      createdAt: 1,
      updatedAt: 1,
    })
    await training.saveSession({
      id: 's',
      programId: 'p',
      week: 1,
      position: 0,
      type: 'runwalk',
      title: 'Week 1',
      notes: null,
    })
    const runs = createSqliteRunRepository(db)
    // The run steps methods are not used before the migration: v5 had no such table
    await runs.createRun(run('r', { sessionId: 's' }))
    await runs.addPoint('r', 0, { lat: 52, lon: 4, timestamp: 2 })
    const programs = await training.exportPrograms()

    expect(await migrate(db)).toBe(MIGRATIONS.length)
    expect(await runs.getRun('r')).toMatchObject({ id: 'r', sessionId: 's' })
    expect(await runs.loadPoints('r')).toHaveLength(1)
    expect(await training.exportPrograms()).toEqual(programs)
    expect(await runs.loadRunSteps('r')).toEqual([])
    await runs.saveStepChange('r', null, [runStep(0)])
    expect(await runs.loadRunSteps('r')).toEqual([runStep(0)])
    expect((await db.query('PRAGMA foreign_key_check;')).values).toEqual([])
  })

  it('refuses steps of a run that does not exist', async () => {
    const db = openTestDb()
    await migrate(db)
    const repo = createSqliteRunRepository(db)
    await expect(repo.saveStepChange('missing', null, [runStep(0)])).rejects.toThrow(
      /FOREIGN KEY constraint failed/,
    )
  })
})
