import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MIGRATIONS } from '../migrations'

// Plays the plugin's connection object; the native side is not available in tests
const plugin = vi.hoisted(() => {
  const db = {
    isDBOpen: vi.fn<() => Promise<{ result: boolean }>>(async () => ({ result: false })),
    open: vi.fn<() => Promise<void>>(async () => {}),
    execute: vi.fn<(sql: string) => Promise<object>>(async () => ({})),
    run: vi.fn<(sql: string, values?: unknown[]) => Promise<object>>(async () => ({})),
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

const { openSqliteRunRepository, toRunRecord, toStoredPoint } =
  await import('../sqliteRunRepository')

describe('sqlite run repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    plugin.consistent = true
    plugin.exists = false
  })

  it('creates the connection, opens it and migrates a fresh database', async () => {
    await openSqliteRunRepository()
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
    await openSqliteRunRepository()
    expect(plugin.retrieveConnection).toHaveBeenCalledWith('runtracker', false)
    expect(plugin.createConnection).not.toHaveBeenCalled()
    expect(plugin.db.open).not.toHaveBeenCalled()
  })

  it('creates a fresh connection when the native side was out of step (WebView reload)', async () => {
    plugin.consistent = false
    plugin.exists = true
    await openSqliteRunRepository()
    expect(plugin.createConnection).toHaveBeenCalled()
    expect(plugin.retrieveConnection).not.toHaveBeenCalled()
  })

  it('stores missing GPS values as NULL', async () => {
    const repo = await openSqliteRunRepository()
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

    const repo = await openSqliteRunRepository()
    await repo.renameRun('a', 'Easy 5k')
    expect(plugin.db.run).toHaveBeenLastCalledWith(
      'UPDATE runs SET name = ?, updated_at = ? WHERE id = ?',
      ['Easy 5k', expect.any(Number), 'a'],
    )
    await repo.renameRun('a', null)
    expect(plugin.db.run.mock.lastCall![1]![0]).toBeNull()
  })

  it('does not touch the name when a run is updated', async () => {
    const repo = await openSqliteRunRepository()
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
    const repo = await openSqliteRunRepository()
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
})
