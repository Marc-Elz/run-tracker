import { describe, expect, it } from 'vitest'
import type { RunRecord, StoredPoint } from '@/lib/db/runRepository'
import type { ProgramBundle } from '@/lib/training'
import { BackupError, backupFileName, buildBackup, parseBackup } from '../backup'

const run = (id: string, over: Partial<RunRecord> = {}): RunRecord => ({
  id,
  name: null,
  status: 'finished',
  startedAt: 1_000,
  finishedAt: 61_000,
  elapsedMs: 60_000,
  segment: 1,
  segmentStartedAt: null,
  movingMs: 55_000,
  distanceM: 150.5,
  ...over,
})
const point = (over: Partial<StoredPoint> = {}): StoredPoint => ({
  segment: 0,
  timestamp: 2_000,
  lat: 52.1,
  lon: 4.3,
  ...over,
})

describe('backupFileName', () => {
  it('uses the local date', () => {
    expect(backupFileName(new Date(2026, 9, 28, 23, 59).getTime())).toBe(
      'run-tracker-backup-2026-10-28.json',
    )
  })
})

describe('buildBackup and parseBackup', () => {
  it('round-trips runs with names, segments and optional fields', () => {
    const runs = [
      {
        run: run('a', { name: 'Haren ✓' }),
        points: [point({ accuracy: 4, altitude: 1.5, speed: 2 }), point({ segment: 1, lat: 52.2 })],
      },
      { run: run('b'), points: [] },
    ]
    const text = buildBackup(runs, [], 5_000)
    expect(JSON.parse(text)).toMatchObject({ format: 'run-tracker-backup', version: 2, exportedAt: 5_000 })
    expect(parseBackup(text)).toEqual({ runs, programs: [], rejected: 0 })
  })

  it('keeps the order of the points', () => {
    const points = [point({ timestamp: 5 }), point({ timestamp: 5, lat: 1 }), point({ timestamp: 3 })]
    const parsed = parseBackup(buildBackup([{ run: run('a'), points }], [], 0))
    expect(parsed.runs[0]!.points).toEqual(points)
  })

  it('refuses text that is not JSON, not ours, or from a newer app, naming the reason', () => {
    expect(() => parseBackup('nope')).toThrow(BackupError)
    expect(() => parseBackup('[]')).toThrow(/not a Run Tracker backup/)
    expect(() => parseBackup('{"format":"other","version":1,"runs":[]}')).toThrow(
      /not a Run Tracker backup/,
    )
    expect(() => parseBackup('{"format":"run-tracker-backup","version":3,"runs":[]}')).toThrow(
      /newer version/,
    )
    expect(() => parseBackup('{"format":"run-tracker-backup","runs":[]}')).toThrow(/version/)
  })

  it('refuses a file holding a run that never finished', () => {
    for (const status of ['running', 'paused']) {
      const text = buildBackup(
        [{ run: run('a'), points: [] }, { run: run('b', { status } as Partial<RunRecord>), points: [] }],
        [],
        0,
      )
      expect(() => parseBackup(text)).toThrow(/never finished/)
    }
  })

  it('leaves out a malformed run and counts it, keeping the others', () => {
    const good = { run: run('good'), points: [point()] }
    const raw = (over: object, points: unknown = []) => ({ run: { ...run('x'), ...over }, points })
    const text = JSON.stringify({
      format: 'run-tracker-backup',
      version: 1,
      exportedAt: 0,
      runs: [
        good,
        raw({ id: '' }),
        raw({ distanceM: null }),
        raw({ elapsedMs: -1 }),
        raw({ startedAt: Infinity }),
        raw({}, [{ lat: 91, lon: 0, timestamp: 1, segment: 0 }]),
        raw({}, [{ lat: 0, lon: 0, timestamp: 1, segment: 0, speed: 'fast' }]),
        raw({}, 'not a list'),
        'not an object',
        { points: [] },
      ],
    })
    const parsed = parseBackup(text)
    expect(parsed.runs.map((r) => r.run.id)).toEqual(['good'])
    expect(parsed.rejected).toBe(9)
  })
})

describe('training programs in the backup', () => {
  const bundle = (id: string): ProgramBundle => ({
    program: {
      id,
      name: 'Half',
      goal: 'Sub 2:00',
      weeks: 10,
      startDate: '2027-01-04',
      createdAt: 1,
      updatedAt: 2,
    },
    sessions: [
      {
        id: `${id}-s`,
        programId: id,
        week: 1,
        position: 0,
        type: 'intervals',
        title: '6×400 m',
        notes: null,
      },
    ],
    steps: [
      {
        id: `${id}-r`,
        sessionId: `${id}-s`,
        position: 0,
        kind: 'repeat',
        targetKind: 'none',
        targetValue: null,
        paceMin: null,
        paceMax: null,
        repetitions: 6,
        span: 1,
      },
      {
        id: `${id}-x`,
        sessionId: `${id}-s`,
        position: 1,
        kind: 'run',
        targetKind: 'distance',
        targetValue: 400,
        paceMin: 290,
        paceMax: 300,
        repetitions: null,
        span: null,
      },
    ],
  })
  const file = (programs: unknown, version = 2) =>
    JSON.stringify({ format: 'run-tracker-backup', version, exportedAt: 0, runs: [], programs })

  it('round-trips programs with their sessions and steps next to the runs', () => {
    const runs = [{ run: run('a'), points: [point()] }]
    const programs = [bundle('p'), bundle('q')]
    expect(parseBackup(buildBackup(runs, programs, 0))).toEqual({ runs, programs, rejected: 0 })
  })

  it('still reads a version 1 file, which has no programs', () => {
    const text = JSON.stringify({
      format: 'run-tracker-backup',
      version: 1,
      exportedAt: 0,
      runs: [],
    })
    expect(parseBackup(text)).toEqual({ runs: [], programs: [], rejected: 0 })
  })

  it('refuses a file whose programs are not a list', () => {
    expect(() => parseBackup(file({}))).toThrow(/training programs cannot be read/)
  })

  it('leaves out a malformed program and counts it, keeping the others', () => {
    const good = bundle('good')
    const broken = (change: (b: ProgramBundle) => unknown) => change(structuredClone(bundle('x')))
    const parsed = parseBackup(
      file([
        good,
        broken((b) => ({ ...b, program: { ...b.program, weeks: 0 } })),
        broken((b) => ({ ...b, program: { ...b.program, startDate: '2027-13-01' } })),
        broken((b) => ({ ...b, sessions: [{ ...b.sessions[0], week: 11 }] })),
        broken((b) => ({ ...b, sessions: [{ ...b.sessions[0], programId: 'other' }] })),
        broken((b) => ({ ...b, sessions: [{ ...b.sessions[0], type: 'sprint' }] })),
        broken((b) => ({ ...b, steps: [{ ...b.steps[0], sessionId: 'nowhere' }] })),
        // The repeat covers one step, but that step is gone
        broken((b) => ({ ...b, steps: [b.steps[0]] })),
        broken((b) => ({ ...b, steps: 'none' })),
        // The rules of a program entered in the app
        broken((b) => ({ ...b, program: { ...b.program, weeks: 500 } })),
        broken((b) => ({ ...b, program: { ...b.program, name: 'x'.repeat(300) } })),
        broken((b) => ({ ...b, sessions: [{ ...b.sessions[0], title: 'x'.repeat(300) }] })),
        'not an object',
      ]),
    )
    expect(parsed.programs.map((p) => p.program.id)).toEqual(['good'])
    expect(parsed.rejected).toBe(12)
  })

  it('trims names and titles as the app does', () => {
    const b = bundle('p')
    b.program.name = '  Half  '
    b.sessions[0]!.title = ' 6×400 m '
    const parsed = parseBackup(file([b]))
    expect(parsed.programs[0]!.program.name).toBe('Half')
    expect(parsed.programs[0]!.sessions[0]!.title).toBe('6×400 m')
  })

  it('says a newer app made the file before looking at its programs', () => {
    expect(() => parseBackup(file({}, 3))).toThrow(/newer version/)
  })

  it('leaves out a program that reuses an id of another one in the same file', () => {
    const first = bundle('p')
    const sameProgram = bundle('p')
    const sameSession = { ...bundle('q'), sessions: [{ ...bundle('q').sessions[0]!, id: 'p-s' }] }
    const parsed = parseBackup(file([first, sameProgram, sameSession]))
    expect(parsed.programs).toEqual([first])
    expect(parsed.rejected).toBe(2)
  })
})
