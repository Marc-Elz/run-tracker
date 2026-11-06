import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MIGRATIONS } from '../migrations'

// Plays the plugin's connection object; the native side is not available in tests
const plugin = vi.hoisted(() => {
  const db = {
    isDBOpen: vi.fn<() => Promise<{ result: boolean }>>(async () => ({ result: false })),
    open: vi.fn<() => Promise<void>>(async () => {}),
    execute: vi.fn<(sql: string) => Promise<object>>(async () => ({})),
    run: vi.fn<(sql: string, values?: unknown[]) => Promise<object>>(async () => ({})),
    executeSet: vi.fn<
      (set: { statement: string; values: unknown[] }[], transaction?: boolean) => Promise<object>
    >(async () => ({})),
    query: vi.fn<
      (sql: string, values?: unknown[]) => Promise<{ values: Record<string, unknown>[] }>
    >(async (sql: string) => ({
      values: sql.startsWith('PRAGMA') ? [{ user_version: 0 }] : [],
    })),
  }
  return {
    db,
    consistent: true,
    exists: false,
    createConnection: vi.fn<(...args: unknown[]) => Promise<typeof db>>(async () => db),
    retrieveConnection: vi.fn<(...args: unknown[]) => Promise<typeof db>>(async () => db),
  }
})
vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  SQLiteConnection: class {
    checkConnectionsConsistency = async () => ({ result: plugin.consistent })
    isConnection = async () => ({ result: plugin.exists })
    createConnection = plugin.createConnection
    retrieveConnection = plugin.retrieveConnection
  },
}))

const { createSqliteRunRepository, toRouteOverview, toRunRecord, toStoredPoint } =
  await import('../sqliteRunRepository')
const { openDb } = await import('../connection')
const openRepo = () => createSqliteRunRepository(plugin.db)

describe('sqlite connection and run repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    plugin.consistent = true
    plugin.exists = false
  })

  it('creates the connection, opens it and migrates a fresh database', async () => {
    await openDb()
    expect(plugin.createConnection).toHaveBeenCalledWith(
      'runtracker',
      false,
      'no-encryption',
      1,
      false,
    )
    expect(plugin.db.open).toHaveBeenCalled()
    expect(plugin.db.execute).toHaveBeenCalledTimes(MIGRATIONS.length)
  })

  it('reuses a connection the plugin still holds instead of creating it again', async () => {
    plugin.exists = true
    plugin.db.isDBOpen.mockResolvedValueOnce({ result: true })
    await openDb()
    expect(plugin.retrieveConnection).toHaveBeenCalledWith('runtracker', false)
    expect(plugin.createConnection).not.toHaveBeenCalled()
    expect(plugin.db.open).not.toHaveBeenCalled()
  })

  it('creates a fresh connection when the native side was out of step (WebView reload)', async () => {
    plugin.consistent = false
    plugin.exists = true
    await openDb()
    expect(plugin.createConnection).toHaveBeenCalled()
    expect(plugin.retrieveConnection).not.toHaveBeenCalled()
  })

  it('stores missing GPS values as NULL', async () => {
    const repo = openRepo()
    await repo.addPoint('a', 2, { lat: 52, lon: 4, timestamp: 1000, accuracy: 8 })
    expect(plugin.db.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO track_points'),
      ['a', 2, 1000, 52, 4, 8, null, null],
    )
  })

  it('maps rows back, leaving out NULL fields', () => {
    expect(
      toStoredPoint({
        segment: 1,
        timestamp: 5,
        lat: 52,
        lon: 4,
        accuracy: 3,
        altitude: null,
        speed: null,
      }),
    ).toEqual({ segment: 1, timestamp: 5, lat: 52, lon: 4, accuracy: 3 })
    expect(
      toRunRecord({
        id: 'a',
        status: 'paused',
        started_at: 1,
        finished_at: null,
        elapsed_ms: 10,
        segment: 2,
        segment_started_at: null,
        moving_ms: 8,
        distance_m: 12.5,
      }),
    ).toEqual({
      id: 'a',
      name: null,
      status: 'paused',
      startedAt: 1,
      finishedAt: null,
      elapsedMs: 10,
      segment: 2,
      segmentStartedAt: null,
      movingMs: 8,
      distanceM: 12.5,
    })
  })

  it('reads the name column and writes a new name or clears it', async () => {
    const row = {
      id: 'a',
      name: 'Morning loop',
      status: 'finished',
      started_at: 1,
      finished_at: 2,
      elapsed_ms: 1,
      segment: 0,
      segment_started_at: null,
      moving_ms: 1,
      distance_m: 10,
    }
    expect(toRunRecord(row).name).toBe('Morning loop')

    const repo = openRepo()
    await repo.renameRun('a', 'Easy 5k')
    expect(plugin.db.run).toHaveBeenLastCalledWith(
      'UPDATE runs SET name = ?, updated_at = ? WHERE id = ?',
      ['Easy 5k', expect.any(Number), 'a'],
    )
    await repo.renameRun('a', null)
    expect(plugin.db.run.mock.lastCall![1]![0]).toBeNull()
  })

  it('does not touch the name when a run is updated', async () => {
    const repo = openRepo()
    await repo.updateRun({
      id: 'a',
      name: null,
      status: 'finished',
      startedAt: 1,
      finishedAt: 2,
      elapsedMs: 1,
      segment: 0,
      segmentStartedAt: null,
      movingMs: 1,
      distanceM: 10,
    })
    expect(plugin.db.run.mock.lastCall![0]).not.toContain('name')
  })

  it('reads one run and the finished runs', async () => {
    const repo = openRepo()
    const row = {
      id: 'a',
      status: 'finished',
      started_at: 1,
      finished_at: 2,
      elapsed_ms: 1,
      segment: 0,
      segment_started_at: null,
      moving_ms: 1,
      distance_m: 10,
    }
    plugin.db.query.mockResolvedValueOnce({ values: [row] })
    expect((await repo.getRun('a'))?.distanceM).toBe(10)
    expect(plugin.db.query).toHaveBeenLastCalledWith('SELECT * FROM runs WHERE id = ?', ['a'])

    plugin.db.query.mockResolvedValueOnce({ values: [] })
    expect(await repo.getRun('b')).toBeNull()

    plugin.db.query.mockResolvedValueOnce({ values: [row] })
    expect((await repo.listFinished()).map((r) => r.id)).toEqual(['a'])
    expect(plugin.db.query.mock.lastCall![0]).toContain(`status = 'finished'`)
  })

  describe('importRun', () => {
    const run = {
      id: 'a',
      name: 'Haren',
      status: 'finished' as const,
      startedAt: 1,
      finishedAt: 2,
      elapsedMs: 1,
      segment: 1,
      segmentStartedAt: null,
      movingMs: 1,
      distanceM: 10,
    }
    const points = [
      { segment: 0, timestamp: 5, lat: 1, lon: 2, accuracy: 3 },
      { segment: 1, timestamp: 4, lat: 5, lon: 6 },
    ]

    it('writes the run, its name and its points in one transaction, in order', async () => {
      const repo = openRepo()
      plugin.db.query.mockResolvedValueOnce({ values: [] })
      expect(await repo.importRun(run, points)).toBe(true)
      const [set, transaction] = plugin.db.executeSet.mock.lastCall!
      expect(transaction).toBe(true)
      expect(set).toHaveLength(3)
      expect(set[0]!.statement).toContain('INSERT INTO runs')
      expect(set[0]!.values.slice(0, 10)).toEqual(['a', 'Haren', 'finished', 1, 2, 1, 1, null, 1, 10])
      expect(set[1]!.values).toEqual(['a', 0, 5, 1, 2, 3, null, null])
      expect(set[2]!.values).toEqual(['a', 1, 4, 5, 6, null, null, null])
    })

    it('writes nothing when the run already exists', async () => {
      const repo = openRepo()
      plugin.db.query.mockResolvedValueOnce({ values: [{ id: 'a' }] })
      expect(await repo.importRun(run, points)).toBe(false)
      expect(plugin.db.executeSet).not.toHaveBeenCalled()
    })

    it('passes on a failed transaction so the caller sees the error', async () => {
      const repo = openRepo()
      plugin.db.query.mockResolvedValueOnce({ values: [] })
      plugin.db.executeSet.mockRejectedValueOnce(new Error('constraint failed'))
      await expect(repo.importRun(run, points)).rejects.toThrow('constraint failed')
    })
  })

  describe('route overviews', () => {
    const lines: [number, number][][] = [
      [
        [4, 52],
        [4.1, 52.1],
      ],
    ]

    it('stores an overview as JSON, replacing an older one', async () => {
      const repo = openRepo()
      await repo.saveOverview({ runId: 'a', algo: 1, lines, bounds: [4, 52, 4.1, 52.1] })
      const [sql, values] = plugin.db.run.mock.lastCall!
      expect(sql).toContain('INSERT OR REPLACE INTO route_overview')
      expect(values).toEqual(['a', 1, '[[[4,52],[4.1,52.1]]]', '[4,52,4.1,52.1]'])
    })

    it('reads the overviews of finished runs back', async () => {
      const repo = openRepo()
      plugin.db.query.mockResolvedValueOnce({
        values: [{ run_id: 'a', algo: 1, lines: '[[[4,52],[4.1,52.1]]]', bounds: null }],
      })
      expect(await repo.readOverviews()).toEqual([{ runId: 'a', algo: 1, lines, bounds: null }])
      expect(plugin.db.query.mock.lastCall![0]).toContain(`status = 'finished'`)
    })

    it('maps a row with and without bounds', () => {
      expect(toRouteOverview({ run_id: 'x', algo: 2, lines: '[]', bounds: '[1,2,3,4]' })).toEqual({
        runId: 'x',
        algo: 2,
        lines: [],
        bounds: [1, 2, 3, 4],
      })
      expect(toRouteOverview({ run_id: 'x', algo: 2, lines: '[]', bounds: null }).bounds).toBeNull()
    })
  })
})
