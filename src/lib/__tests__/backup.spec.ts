import { describe, expect, it } from 'vitest'
import type { RunRecord, StoredPoint } from '@/lib/db/runRepository'
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
    const text = buildBackup(runs, 5_000)
    expect(JSON.parse(text)).toMatchObject({ format: 'run-tracker-backup', version: 1, exportedAt: 5_000 })
    expect(parseBackup(text)).toEqual({ runs, rejected: 0 })
  })

  it('keeps the order of the points', () => {
    const points = [point({ timestamp: 5 }), point({ timestamp: 5, lat: 1 }), point({ timestamp: 3 })]
    const parsed = parseBackup(buildBackup([{ run: run('a'), points }], 0))
    expect(parsed.runs[0]!.points).toEqual(points)
  })

  it('refuses text that is not JSON, not ours, or from a newer app, naming the reason', () => {
    expect(() => parseBackup('nope')).toThrow(BackupError)
    expect(() => parseBackup('[]')).toThrow(/not a Run Tracker backup/)
    expect(() => parseBackup('{"format":"other","version":1,"runs":[]}')).toThrow(
      /not a Run Tracker backup/,
    )
    expect(() => parseBackup('{"format":"run-tracker-backup","version":2,"runs":[]}')).toThrow(
      /newer version/,
    )
    expect(() => parseBackup('{"format":"run-tracker-backup","runs":[]}')).toThrow(/version/)
  })

  it('refuses a file holding a run that never finished', () => {
    for (const status of ['running', 'paused']) {
      const text = buildBackup(
        [{ run: run('a'), points: [] }, { run: run('b', { status } as Partial<RunRecord>), points: [] }],
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
