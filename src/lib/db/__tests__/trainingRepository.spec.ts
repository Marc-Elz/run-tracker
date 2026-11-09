import { describe, expect, it } from 'vitest'
import type { ProgramSession, SessionStep, TrainingProgram } from '@/lib/training'
import { createMemoryTrainingRepository } from '../memoryTrainingRepository'
import { createSqliteTrainingRepository } from '../sqliteTrainingRepository'
import { createSqliteRunRepository } from '../sqliteRunRepository'
import { MIGRATIONS, migrate } from '../migrations'
import { createQueue, serialized } from '../runRepository'
import {
  nextUpdatedAt,
  serializedTraining,
  unavailableTrainingRepository,
  type TrainingRepository,
} from '../trainingRepository'
import { nodeSqlite, openTestDb } from './nodeSqlite'

const program = (id: string, over: Partial<TrainingProgram> = {}): TrainingProgram => ({
  id,
  name: `Program ${id}`,
  goal: null,
  weeks: 4,
  startDate: null,
  createdAt: 1_000,
  updatedAt: 1_000,
  ...over,
})
const session = (id: string, programId: string, over: Partial<ProgramSession> = {}) =>
  ({
    id,
    programId,
    week: 1,
    position: 0,
    type: 'easy',
    title: `Session ${id}`,
    notes: null,
    ...over,
  }) satisfies ProgramSession
const step = (id: string, sessionId: string, over: Partial<SessionStep> = {}): SessionStep => ({
  id,
  sessionId,
  position: 0,
  kind: 'run',
  targetKind: 'distance',
  targetValue: 400,
  paceMin: 290,
  paceMax: 300,
  repetitions: null,
  span: null,
  ...over,
})

async function sqliteRepo() {
  const db = openTestDb()
  await migrate(db)
  return createSqliteTrainingRepository(db)
}

const implementations: [string, () => Promise<TrainingRepository>][] = [
  ['memory', async () => createMemoryTrainingRepository()],
]
if (nodeSqlite) implementations.push(['sqlite', sqliteRepo])

describe.each(implementations)('%s training repository', (_name, open) => {
  it('lists programs newest first with their session count', async () => {
    const repo = await open()
    await repo.createProgram(program('old', { createdAt: 1 }))
    await repo.createProgram(program('new', { createdAt: 2 }))
    await repo.saveSession(session('s1', 'old'))
    await repo.saveSession(session('s2', 'old', { position: 1 }))
    const list = await repo.listPrograms()
    expect(list.map((p) => [p.id, p.sessionCount])).toEqual([
      ['new', 0],
      ['old', 2],
    ])
    expect(await repo.getProgram('old')).toMatchObject({
      id: 'old',
      name: 'Program old',
      createdAt: 1,
    })
    expect(await repo.getProgram('none')).toBeNull()
  })

  it('updates a program, keeping its creation time and moving updatedAt forward', async () => {
    const repo = await open()
    await repo.createProgram(program('p'))
    await repo.updateProgram({
      ...program('p'),
      name: 'Half',
      weeks: 10,
      startDate: '2027-01-04',
      createdAt: 5,
    })
    const updated = (await repo.getProgram('p'))!
    expect(updated).toMatchObject({
      name: 'Half',
      weeks: 10,
      startDate: '2027-01-04',
      createdAt: 1_000,
    })
    expect(updated.updatedAt).toBeGreaterThan(1_000)
  })

  it('orders sessions by week, then position, and edits one in place', async () => {
    const repo = await open()
    await repo.createProgram(program('p'))
    await repo.saveSession(session('b', 'p', { week: 2, position: 0 }))
    await repo.saveSession(session('c', 'p', { week: 1, position: 5 }))
    await repo.saveSession(session('a', 'p', { week: 1, position: 2 }))
    expect((await repo.listSessions('p')).map((s) => s.id)).toEqual(['a', 'c', 'b'])

    await repo.saveSession(session('a', 'p', { week: 3, title: '6×400 m', type: 'intervals' }))
    expect(await repo.getSession('a')).toMatchObject({
      week: 3,
      title: '6×400 m',
      type: 'intervals',
    })
    expect(await repo.listSessions('p')).toHaveLength(3)
  })

  it('moves the program forward on every session or step write, so a backup sees it', async () => {
    const repo = await open()
    await repo.createProgram(program('p'))
    const times = [(await repo.getProgram('p'))!.updatedAt]
    const mark = async () => times.push((await repo.getProgram('p'))!.updatedAt)
    await repo.saveSession(session('s', 'p'))
    await mark()
    await repo.saveSession(session('s', 'p', { notes: 'Hilly' }))
    await mark()
    await repo.replaceSteps('s', [step('x', 's')])
    await mark()
    await repo.deleteSession('s')
    await mark()
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]!)
  })

  it('replaces the steps of a session, keeping their order', async () => {
    const repo = await open()
    await repo.createProgram(program('p'))
    await repo.saveSession(session('s', 'p'))
    await repo.replaceSteps('s', [step('one', 's'), step('two', 's', { position: 1 })])
    const repeat = step('r', 's', {
      kind: 'repeat',
      targetKind: 'none',
      targetValue: null,
      paceMin: null,
      paceMax: null,
      repetitions: 6,
      span: 2,
    })
    await repo.replaceSteps('s', [
      repeat,
      step('run', 's', { position: 1 }),
      step('rec', 's', {
        position: 2,
        kind: 'recovery',
        targetKind: 'duration',
        targetValue: 90,
        paceMin: null,
        paceMax: null,
      }),
    ])
    const steps = await repo.loadSteps('s')
    expect(steps.map((s) => s.id)).toEqual(['r', 'run', 'rec'])
    expect(steps[0]).toEqual(repeat)
    expect(steps[2]).toMatchObject({ targetKind: 'duration', targetValue: 90, paceMin: null })
  })

  it('drops the steps of a session that becomes a rest day', async () => {
    const repo = await open()
    await repo.createProgram(program('p'))
    await repo.saveSession(session('s', 'p'))
    await repo.replaceSteps('s', [step('x', 's')])
    await repo.saveSession(session('s', 'p', { type: 'rest', title: 'Rest' }))
    expect(await repo.loadSteps('s')).toEqual([])
  })

  it('writes nothing and says so when a session or step id of an import is already used', async () => {
    const repo = await open()
    await repo.createProgram(program('p'))
    await repo.saveSession(session('s', 'p'))
    await repo.replaceSteps('s', [step('x', 's')])
    const bySession = { program: program('q'), sessions: [session('s', 'q')], steps: [] }
    const byStep = {
      program: program('r'),
      sessions: [session('t', 'r')],
      steps: [step('x', 't')],
    }
    expect(await repo.importProgram(bySession)).toBe('clash')
    expect(await repo.importProgram(byStep)).toBe('clash')
    expect(await repo.getProgram('q')).toBeNull()
    expect(await repo.getProgram('r')).toBeNull()
    expect(await repo.getSession('t')).toBeNull()
  })

  it('deletes a program with all its sessions and steps, leaving other programs alone', async () => {
    const repo = await open()
    await repo.createProgram(program('p'))
    await repo.createProgram(program('q'))
    await repo.saveSession(session('s', 'p'))
    await repo.saveSession(session('t', 'q'))
    await repo.replaceSteps('s', [step('x', 's')])
    await repo.deleteProgram('p')
    expect(await repo.getProgram('p')).toBeNull()
    expect(await repo.getSession('s')).toBeNull()
    expect(await repo.loadSteps('s')).toEqual([])
    expect(await repo.getSession('t')).not.toBeNull()
  })

  it('exports every program with its sessions and steps, and imports it back as it was', async () => {
    const repo = await open()
    await repo.createProgram(program('p', { goal: 'Sub 2:00', startDate: '2027-01-04' }))
    await repo.saveSession(session('s', 'p'))
    await repo.saveSession(session('t', 'p', { week: 2, type: 'rest', title: 'Rest' }))
    await repo.replaceSteps('s', [step('x', 's'), step('y', 's', { position: 1 })])
    const exported = await repo.exportPrograms()
    expect(exported).toHaveLength(1)
    expect(exported[0]!.sessions.map((s) => s.id)).toEqual(['s', 't'])
    expect(exported[0]!.steps.map((s) => s.id)).toEqual(['x', 'y'])

    const target = await open()
    expect(await target.importProgram(exported[0]!)).toBe('added')
    expect(await target.exportPrograms()).toEqual(exported)
    expect(await target.importProgram(exported[0]!)).toBe('exists')
    expect(await target.listPrograms()).toHaveLength(1)
  })
})

describe.skipIf(!nodeSqlite)('training tables on real SQLite', () => {
  it('stores nothing of a program whose import fails halfway', async () => {
    const repo = await sqliteRepo()
    // Two steps with one id: the second insert fails inside the transaction
    const broken = {
      program: program('q'),
      sessions: [session('s', 'q')],
      steps: [step('x', 's'), step('x', 's', { position: 1 })],
    }
    await expect(repo.importProgram(broken)).rejects.toThrow(/UNIQUE constraint failed/)
    expect(await repo.getProgram('q')).toBeNull()
    expect(await repo.getSession('s')).toBeNull()
  })

  it('never moves a session to another program when its id is saved again', async () => {
    const repo = await sqliteRepo()
    await repo.createProgram(program('p'))
    await repo.createProgram(program('q'))
    await repo.saveSession(session('s', 'p'))
    await repo.saveSession(session('s', 'q', { title: 'Hijack' }))
    expect(await repo.getSession('s')).toMatchObject({ programId: 'p', title: 'Session s' })
  })

  it('refuses rows the schema does not allow', async () => {
    const repo = await sqliteRepo()
    await expect(repo.createProgram(program('p', { weeks: 0 }))).rejects.toThrow(
      /CHECK constraint failed/,
    )
    await repo.createProgram(program('p'))
    await expect(
      repo.saveSession({ ...session('s', 'p'), type: 'sprint' as ProgramSession['type'] }),
    ).rejects.toThrow(/CHECK constraint failed/)
    await expect(repo.saveSession(session('s', 'missing'))).rejects.toThrow(
      /FOREIGN KEY constraint failed/,
    )
  })

  it('adds the training tables to a phone that already holds runs, keeping the runs', async () => {
    const db = openTestDb()
    // The schema as it was before this migration, with a run and its points in it
    for (const [i, sql] of MIGRATIONS.slice(0, 2).entries()) {
      await db.execute(`${sql}PRAGMA user_version = ${i + 1};\n`)
    }
    const runs = createSqliteRunRepository(db)
    const run = {
      id: 'r',
      name: null,
      status: 'finished' as const,
      startedAt: 1,
      finishedAt: 2,
      elapsedMs: 1,
      segment: 0,
      segmentStartedAt: null,
      movingMs: 1,
      distanceM: 10,
    }
    await runs.importRun(run, [{ segment: 0, timestamp: 1, lat: 52, lon: 4 }])

    expect(await migrate(db)).toBe(MIGRATIONS.length)
    expect(await runs.getRun('r')).toEqual(run)
    expect(await runs.loadPoints('r')).toHaveLength(1)
    const training = createSqliteTrainingRepository(db)
    await training.createProgram(program('p'))
    expect(await training.listPrograms()).toHaveLength(1)
  })

  it('keeps every program, session and step when migration 4 rebuilds the tables (#100)', async () => {
    const db = openTestDb()
    for (const [i, sql] of MIGRATIONS.slice(0, 3).entries()) {
      await db.execute(`${sql}PRAGMA user_version = ${i + 1};\n`)
    }
    // A program as PR 1 stored it: two sessions, one with a repeat and its steps
    const before = createSqliteTrainingRepository(db)
    await before.createProgram(program('p'))
    await before.saveSession(session('s', 'p', { type: 'intervals' }))
    await before.saveSession(session('t', 'p', { week: 2, notes: 'Hilly' }))
    const steps = [
      step('r', 's', {
        kind: 'repeat',
        targetKind: 'none',
        targetValue: null,
        paceMin: null,
        paceMax: null,
        repetitions: 6,
        span: 2,
      }),
      step('run', 's', { position: 1 }),
      step('rec', 's', { position: 2, kind: 'recovery', paceMin: null, paceMax: null }),
    ]
    await before.replaceSteps('s', steps)
    const exported = await before.exportPrograms()

    expect(await migrate(db)).toBe(MIGRATIONS.length)
    const after = createSqliteTrainingRepository(db)
    expect(await after.exportPrograms()).toEqual(exported)
    expect((await db.query('PRAGMA foreign_key_check;')).values).toEqual([])
    const indexes = await db.query(
      "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name;",
    )
    expect(indexes.values?.map((r) => r.name)).toEqual(
      expect.arrayContaining(['program_sessions_program', 'session_steps_session']),
    )

    // The new values are allowed, and the cascade still works
    await after.saveSession(session('w', 'p', { type: 'runwalk', week: 3 }))
    await after.saveSession(session('x', 'p', { type: 'walk', week: 3, position: 1 }))
    await after.replaceSteps('w', [step('wk', 'w', { kind: 'walk', paceMin: null, paceMax: null })])
    expect((await after.loadSteps('w'))[0]!.kind).toBe('walk')
    await after.deleteProgram('p')
    expect((await db.query('SELECT COUNT(*) AS n FROM session_steps;')).values?.[0]?.n).toBe(0)
  })
})

describe('serializedTraining', () => {
  it('shares one queue with the run repository, so their writes never interleave', async () => {
    const order: string[] = []
    const slow = (label: string, ms: number) =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          order.push(label)
          resolve()
        }, ms),
      )
    const queue = createQueue()
    const runs = serialized({ addPoint: () => slow('point', 20) } as never, queue)
    const training = serializedTraining({ saveSession: () => slow('session', 0) } as never, queue)
    await Promise.all([
      runs.addPoint('r', 0, { lat: 0, lon: 0, timestamp: 0 }),
      training.saveSession(session('s', 'p')),
    ])
    expect(order).toEqual(['point', 'session'])
  })

  it('fails every call when the database is unavailable', async () => {
    const repo = unavailableTrainingRepository(new Error('no db'))
    await expect(repo.listPrograms()).rejects.toThrow('Database unavailable')
  })
})

describe('nextUpdatedAt', () => {
  it('is now, but always later than before', () => {
    expect(nextUpdatedAt(5, 100)).toBe(100)
    expect(nextUpdatedAt(100, 100)).toBe(101)
  })
})
