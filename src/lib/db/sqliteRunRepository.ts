import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
import type { TrackPoint } from '@/lib/geo'
import { migrate } from './migrations'
import type { RunRecord, RunRepository, StoredPoint, StoredRunStatus } from './runRepository'

const DB_NAME = 'runtracker'

type Row = Record<string, unknown>

const optional = (value: unknown): number | undefined =>
  value === null || value === undefined ? undefined : Number(value)

export function toRunRecord(row: Row): RunRecord {
  return {
    id: String(row.id),
    name: row.name === null || row.name === undefined ? null : String(row.name),
    status: row.status as StoredRunStatus,
    startedAt: Number(row.started_at),
    finishedAt: optional(row.finished_at) ?? null,
    elapsedMs: Number(row.elapsed_ms),
    segment: Number(row.segment),
    segmentStartedAt: optional(row.segment_started_at) ?? null,
    movingMs: Number(row.moving_ms),
    distanceM: Number(row.distance_m),
  }
}

export function toStoredPoint(row: Row): StoredPoint {
  const point: StoredPoint = {
    segment: Number(row.segment),
    timestamp: Number(row.timestamp),
    lat: Number(row.lat),
    lon: Number(row.lon),
  }
  const accuracy = optional(row.accuracy)
  const altitude = optional(row.altitude)
  const speed = optional(row.speed)
  if (accuracy !== undefined) point.accuracy = accuracy
  if (altitude !== undefined) point.altitude = altitude
  if (speed !== undefined) point.speed = speed
  return point
}

/**
 * Open the app database and bring its schema up to date. Every `run` call commits on its
 * own, so a killed app loses at most the write in flight.
 */
export async function openSqliteRunRepository(): Promise<RunRepository> {
  const sqlite = new SQLiteConnection(CapacitorSQLite)
  // The native side outlives a WebView reload; this closes connections JS no longer knows
  // about, so the create below doesn't fail with "Connection runtracker already exists"
  const consistent = (await sqlite.checkConnectionsConsistency()).result
  const exists = (await sqlite.isConnection(DB_NAME, false)).result
  const db =
    consistent && exists
      ? await sqlite.retrieveConnection(DB_NAME, false)
      : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false)
  if (!(await db.isDBOpen()).result) await db.open()
  await migrate(db)

  return {
    async createRun(run) {
      const now = Date.now()
      await db.run(
        `INSERT INTO runs (id, status, started_at, finished_at, elapsed_ms, segment,
          segment_started_at, moving_ms, distance_m, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          run.id,
          run.status,
          run.startedAt,
          run.finishedAt,
          run.elapsedMs,
          run.segment,
          run.segmentStartedAt,
          run.movingMs,
          run.distanceM,
          now,
          now,
        ],
      )
    },
    async updateRun(run) {
      await db.run(
        `UPDATE runs SET status = ?, finished_at = ?, elapsed_ms = ?, segment = ?,
          segment_started_at = ?, moving_ms = ?, distance_m = ?, updated_at = ?
         WHERE id = ?`,
        [
          run.status,
          run.finishedAt,
          run.elapsedMs,
          run.segment,
          run.segmentStartedAt,
          run.movingMs,
          run.distanceM,
          Date.now(),
          run.id,
        ],
      )
    },
    async addPoint(runId: string, segment: number, p: TrackPoint) {
      await db.run(
        `INSERT INTO track_points (run_id, segment, timestamp, lat, lon, accuracy, altitude, speed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          runId,
          segment,
          p.timestamp,
          p.lat,
          p.lon,
          p.accuracy ?? null,
          p.altitude ?? null,
          p.speed ?? null,
        ],
      )
    },
    async renameRun(id, name) {
      await db.run('UPDATE runs SET name = ?, updated_at = ? WHERE id = ?', [name, Date.now(), id])
    },
    async deleteRun(id) {
      // Points go with it (ON DELETE CASCADE; the plugin turns foreign keys on)
      await db.run('DELETE FROM runs WHERE id = ?', [id])
    },
    async findUnfinished() {
      const result = await db.query(
        `SELECT * FROM runs WHERE status != 'finished' ORDER BY started_at DESC`,
      )
      return (result.values ?? []).map(toRunRecord)
    },
    async getRun(id) {
      const result = await db.query('SELECT * FROM runs WHERE id = ?', [id])
      const row = result.values?.[0]
      return row ? toRunRecord(row) : null
    },
    async listFinished() {
      const result = await db.query(
        `SELECT * FROM runs WHERE status = 'finished' ORDER BY started_at DESC`,
      )
      return (result.values ?? []).map(toRunRecord)
    },
    async loadPoints(runId) {
      const result = await db.query(
        `SELECT segment, timestamp, lat, lon, accuracy, altitude, speed FROM track_points
         WHERE run_id = ? ORDER BY segment, timestamp, id`,
        [runId],
      )
      return (result.values ?? []).map(toStoredPoint)
    },
  }
}
