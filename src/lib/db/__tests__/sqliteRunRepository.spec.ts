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
})
