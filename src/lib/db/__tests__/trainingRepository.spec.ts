import { describe, expect, it } from 'vitest'
import type { ProgramSession, SessionStep, TrainingProgram } from '@/lib/training'
import { createMemoryTrainingRepository } from '../memoryTrainingRepository'
import { createSqliteTrainingRepository } from '../sqliteTrainingRepository'
import { createSqliteRunRepository } from '../sqliteRunRepository'
import { MIGRATIONS, migrate, type SqlConnection } from '../migrations'
import type { RunRecord } from '../runRepository'
import { createQueue, serialized } from '../runRepository'
import {
  nextUpdatedAt,
  serializedTraining,
  unavailableTrainingRepository,
  type TrainingRepository,
} from '../trainingRepository'
import { nodeSqlite, openTestDb, programSnapshot } from './nodeSqlite'

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

/** A finished run as an older schema stored it: no session link */
const oldRun = (id: string): RunRecord => ({
  id,
  name: null,
  status: 'finished',
  startedAt: 1,
  finishedAt: 2,
  elapsedMs: 1,
  segment: 0,
  segmentStartedAt: null,
  movingMs: 1,
  distanceM: 10,
  sessionId: null,
})

/** Writes `oldRun(id)` and one point with the columns every schema version has */
async function insertOldRun(db: SqlConnection, id: string) {
  await db.run(
    `INSERT INTO runs (id, status, started_at, finished_at, elapsed_ms, segment, moving_ms,
      distance_m, created_at, updated_at) VALUES (?, 'finished', 1, 2, 1, 0, 1, 10, 0, 0)`,
    [id],
  )
  await db.run(
    'INSERT INTO track_points (run_id, segment, timestamp, lat, lon) VALUES (?, 0, 1, 52, 4)',
    [id],
  )
}

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

describe.each(implementations)('%s skipped sessions (#102)', (_name, open) => {
  async function seed() {
    const repo = await open()
    await repo.createProgram(program('p'))
    await repo.createProgram(program('q', { createdAt: 2_000, updatedAt: 2_000 }))
    await repo.saveSession(session('s', 'p'))
    await repo.saveSession(session('t', 'p', { position: 1 }))
    await repo.saveSession(session('u', 'q'))
    return repo
  }

  it('marks sessions skipped in every program, and clears the mark', async () => {
    const repo = await seed()
    expect(await repo.skippedSessionIds()).toEqual([])
    await repo.setSkipped('s', true)
    await repo.setSkipped('u', true)
    await repo.setSkipped('s', true)
    expect(await repo.skippedSessionIds()).toEqual(['s', 'u'])
    await repo.setSkipped('s', false)
    expect(await repo.skippedSessionIds()).toEqual(['u'])
  })

  it('does nothing for a session that does not exist', async () => {
    const repo = await seed()
    await repo.setSkipped('nope', true)
    expect(await repo.skippedSessionIds()).toEqual([])
  })

  it('moves the program forward, so a backup sees a skip', async () => {
    const repo = await seed()
    const before = (await repo.getProgram('p'))!.updatedAt
    await repo.setSkipped('s', true)
    const marked = (await repo.getProgram('p'))!.updatedAt
    expect(marked).toBeGreaterThan(before)
    await repo.setSkipped('s', false)
    expect((await repo.getProgram('p'))!.updatedAt).toBeGreaterThan(marked)
  })

  it('drops the mark with its session or program', async () => {
    const repo = await seed()
    await repo.setSkipped('s', true)
    await repo.setSkipped('u', true)
    await repo.deleteSession('s')
    expect(await repo.skippedSessionIds()).toEqual(['u'])
    await repo.deleteProgram('q')
    expect(await repo.skippedSessionIds()).toEqual([])
  })

  it('clears the mark when a session becomes a rest day, so it cannot return unasked', async () => {
    const repo = await seed()
    await repo.setSkipped('s', true)
    await repo.saveSession(session('s', 'p', { type: 'rest', title: 'Rest' }))
    expect(await repo.skippedSessionIds()).toEqual([])
    await repo.saveSession(session('s', 'p'))
    expect(await repo.skippedSessionIds()).toEqual([])
  })

  it("imports only the skips of the program's own sessions", async () => {
    const source = await seed()
    const [bundle] = await source.exportPrograms()
    const target = await open()
    expect(await target.importProgram({ ...bundle!, skipped: ['s', 'u', 'nope'] })).toBe('added')
    expect(await target.skippedSessionIds()).toEqual(['s'])
  })

  it('exports the skipped ids with their program, and imports them back', async () => {
    const repo = await seed()
    await repo.setSkipped('t', true)
    const exported = await repo.exportPrograms()
    expect(exported.find((b) => b.program.id === 'p')?.skipped).toEqual(['t'])
    expect(exported.find((b) => b.program.id === 'q')).not.toHaveProperty('skipped')

    const target = await open()
    for (const bundle of exported) expect(await target.importProgram(bundle)).toBe('added')
    expect(await target.skippedSessionIds()).toEqual(['t'])
    expect(await target.exportPrograms()).toEqual(exported)
  })
})

describe.skipIf(!nodeSqlite)('training tables on real SQLite', () => {
  it('adds the skipped sessions table on a phone with runs and programs, keeping every row (#102)', async () => {
    const db = openTestDb()
    for (const [i, sql] of MIGRATIONS.slice(0, 7).entries()) {
      await db.execute(`${sql}PRAGMA user_version = ${i + 1};\n`)
    }
    const before = createSqliteTrainingRepository(db)
    await before.createProgram(program('p'))
    await before.saveSession(session('s', 'p'))
    await before.replaceSteps('s', [step('x', 's')])
    const runs = createSqliteRunRepository(db)
    await runs.createRun({ ...oldRun('r'), sessionId: 's' })
    const snapshot = await programSnapshot(before)

    expect(await migrate(db)).toBe(MIGRATIONS.length)
    expect(await programSnapshot(before)).toEqual(snapshot)
    expect((await runs.getRun('r'))?.sessionId).toBe('s')
    expect(await before.skippedSessionIds()).toEqual([])
    await before.setSkipped('s', true)
    expect(await before.skippedSessionIds()).toEqual(['s'])
    expect((await db.query('PRAGMA foreign_key_check;')).values).toEqual([])
  })

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
    // Raw SQL: today's repository writes columns this old schema doesn't have yet
    await insertOldRun(db, 'r')

    expect(await migrate(db)).toBe(MIGRATIONS.length)
    const runs = createSqliteRunRepository(db)
    expect(await runs.getRun('r')).toEqual(oldRun('r'))
    expect(await runs.loadPoints('r')).toHaveLength(1)
    const training = createSqliteTrainingRepository(db)
    await training.createProgram(program('p'))
    expect(await training.listPrograms()).toHaveLength(1)
  })

  it('adds the run-to-session link on a phone with runs and programs, keeping every row (#40)', async () => {
    const db = openTestDb()
    for (const [i, sql] of MIGRATIONS.slice(0, 4).entries()) {
      await db.execute(`${sql}PRAGMA user_version = ${i + 1};\n`)
    }
    await insertOldRun(db, 'r')
    const before = createSqliteTrainingRepository(db)
    await before.createProgram(program('p'))
    await before.saveSession(session('s', 'p'))
    await before.replaceSteps('s', [step('x', 's')])
    const exported = await programSnapshot(before)

    expect(await migrate(db)).toBe(MIGRATIONS.length)
    const runs = createSqliteRunRepository(db)
    expect(await runs.getRun('r')).toEqual(oldRun('r'))
    expect(await runs.loadPoints('r')).toHaveLength(1)
    expect(await programSnapshot(createSqliteTrainingRepository(db))).toEqual(exported)
    expect((await db.query('PRAGMA foreign_key_check;')).values).toEqual([])
  })
})

describe.skipIf(!nodeSqlite)('runs linked to sessions on real SQLite (#40)', () => {
  async function setup() {
    const db = openTestDb()
    await migrate(db)
    const training = createSqliteTrainingRepository(db)
    await training.createProgram(program('p'))
    await training.saveSession(session('s', 'p'))
    await training.saveSession(session('t', 'p', { position: 1 }))
    return { db, training, runs: createSqliteRunRepository(db) }
  }
  const linked = (
    id: string,
    sessionId: string | null,
    status: RunRecord['status'] = 'finished',
  ) => ({
    ...oldRun(id),
    status,
    sessionId,
  })

  it('stores the link and counts the session done only once its run is finished', async () => {
    const { runs } = await setup()
    expect(await runs.createRun(linked('a', 's', 'running'))).toBe('s')
    expect((await runs.getRun('a'))!.sessionId).toBe('s')
    expect(await runs.doneSessionIds()).toEqual([])
    await runs.updateRun({ ...linked('a', 's'), sessionId: null })
    // updateRun never touches the link
    expect((await runs.getRun('a'))!.sessionId).toBe('s')
    expect(await runs.doneSessionIds()).toEqual(['s'])
  })

  it('saves the run without a link when the session is gone, and links a second run to the same session (#116)', async () => {
    const { runs } = await setup()
    expect(await runs.createRun(linked('a', 'missing', 'running'))).toBeNull()
    expect(await runs.createRun(linked('b', 's', 'running'))).toBe('s')
    expect(await runs.createRun(linked('c', 's', 'running'))).toBe('s')
    expect((await runs.getRun('c'))!.sessionId).toBe('s')
    expect(await runs.importRun(linked('d', 's'), [])).toBe(true)
    expect((await runs.getRun('d'))!.sessionId).toBe('s')
    expect(await runs.importRun(linked('e', 't'), [])).toBe(true)
    expect((await runs.getRun('e'))!.sessionId).toBe('t')
  })

  it('links a free run to a session afterwards, moves it and unlinks it (#102)', async () => {
    const { runs } = await setup()
    await runs.importRun(linked('a', null), [])
    expect(await runs.setRunSession('a', 's')).toBe('s')
    expect(await runs.doneSessionIds()).toEqual(['s'])
    // Moving the run to another session leaves the first one without a run
    expect(await runs.setRunSession('a', 't')).toBe('t')
    expect(await runs.doneSessionIds()).toEqual(['t'])
    expect(await runs.setRunSession('a', null)).toBeNull()
    expect((await runs.getRun('a'))!.sessionId).toBeNull()
    expect(await runs.doneSessionIds()).toEqual([])
  })

  it('stores no link for a session that does not exist, and refuses a run that does not exist (#102)', async () => {
    const { runs } = await setup()
    await runs.importRun(linked('a', null), [])
    expect(await runs.setRunSession('a', 'missing')).toBeNull()
    await expect(runs.setRunSession('nope', 's')).rejects.toThrow('not found')
  })

  it('keeps the runs and clears their link when a session or the whole program is deleted', async () => {
    const { runs, training } = await setup()
    await runs.importRun(linked('a', 's'), [])
    await runs.importRun(linked('b', 't'), [])
    await training.deleteSession('s')
    expect((await runs.getRun('a'))!.sessionId).toBeNull()
    await training.deleteProgram('p')
    expect((await runs.getRun('b'))!.sessionId).toBeNull()
    expect(await runs.listFinished()).toHaveLength(2)
    expect(await runs.doneSessionIds()).toEqual([])
  })

  it('keeps the session done while one finished run is left after a redo is discarded (#116)', async () => {
    const { runs } = await setup()
    await runs.createRun(linked('a', 's'))
    await runs.createRun(linked('b', 's', 'running'))
    await runs.deleteRun('b')
    expect(await runs.doneSessionIds()).toEqual(['s'])
    await runs.deleteRun('a')
    expect(await runs.doneSessionIds()).toEqual([])
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
    const exported = await programSnapshot(before)

    expect(await migrate(db)).toBe(MIGRATIONS.length)
    const after = createSqliteTrainingRepository(db)
    expect(await programSnapshot(after)).toEqual(exported)
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
