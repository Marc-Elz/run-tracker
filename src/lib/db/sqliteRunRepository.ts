import type { TrackPoint } from '@/lib/geo'
import type { RouteOverview } from '@/lib/routeOverview'
import type { RunStep, RunStepKind } from '@/lib/stepProgress'
import type { TargetKind } from '@/lib/training'
import type { SqlConnection } from './migrations'
import type { RunRecord, RunRepository, StoredPoint, StoredRunStatus } from './runRepository'

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
    sessionId:
      row.session_id === null || row.session_id === undefined ? null : String(row.session_id),
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

export function toRouteOverview(row: Row): RouteOverview {
  return {
    runId: String(row.run_id),
    algo: Number(row.algo),
    lines: JSON.parse(String(row.lines)) as RouteOverview['lines'],
    bounds:
      row.bounds === null || row.bounds === undefined
        ? null
        : (JSON.parse(String(row.bounds)) as RouteOverview['bounds']),
  }
}

export function toRunStep(row: Row): RunStep {
  return {
    position: Number(row.position),
    kind: String(row.kind) as RunStepKind,
    targetKind: String(row.target_kind) as TargetKind,
    targetValue: optional(row.target_value) ?? null,
    paceMin: optional(row.pace_min) ?? null,
    paceMax: optional(row.pace_max) ?? null,
    repetition: optional(row.repetition) ?? null,
    repetitions: optional(row.repetitions) ?? null,
    startedElapsedMs: Number(row.started_elapsed_ms),
    startedDistanceM: Number(row.started_distance_m),
    endedElapsedMs: optional(row.ended_elapsed_ms) ?? null,
    endedDistanceM: optional(row.ended_distance_m) ?? null,
  }
}

const insertStep = (runId: string, s: RunStep) => ({
  statement: `INSERT INTO run_steps (run_id, position, kind, target_kind, target_value, pace_min,
    pace_max, repetition, repetitions, started_elapsed_ms, started_distance_m, ended_elapsed_ms,
    ended_distance_m) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  values: [
    runId,
    s.position,
    s.kind,
    s.targetKind,
    s.targetValue,
    s.paceMin,
    s.paceMax,
    s.repetition,
    s.repetitions,
    s.startedElapsedMs,
    s.startedDistanceM,
    s.endedElapsedMs,
    s.endedDistanceM,
  ],
})

/**
 * The value written to `runs.session_id`: the session when it exists and has no run yet, else
 * NULL. Takes the session id as its one value. A dangling or second link would fail the whole
 * insert, and a run must never go unsaved over its link.
 */
const SESSION_LINK = `(SELECT s.id FROM program_sessions s WHERE s.id = ?
  AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.session_id = s.id))`

/**
 * Runs on the app database (opened by `openDb`). Every `run` call commits on its own, so a killed
 * app loses at most the write in flight.
 */
export function createSqliteRunRepository(db: SqlConnection): RunRepository {
  return {
    async createRun(run) {
      const now = Date.now()
      await db.run(
        `INSERT INTO runs (id, status, started_at, finished_at, elapsed_ms, segment,
          segment_started_at, moving_ms, distance_m, created_at, updated_at, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${SESSION_LINK})`,
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
          run.sessionId,
        ],
      )
      const stored = await db.query('SELECT session_id FROM runs WHERE id = ?', [run.id])
      const link = stored.values?.[0]?.session_id
      return link === null || link === undefined ? null : String(link)
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
      // Points and steps go with it (ON DELETE CASCADE; the plugin turns foreign keys on)
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
    async importRun(run, points, steps = []) {
      const existing = await db.query('SELECT id FROM runs WHERE id = ?', [run.id])
      if ((existing.values ?? []).length > 0) return false
      const now = Date.now()
      // One transaction: either the whole run is stored or none of it
      await db.executeSet(
        [
          {
            statement: `INSERT INTO runs (id, name, status, started_at, finished_at, elapsed_ms,
              segment, segment_started_at, moving_ms, distance_m, created_at, updated_at, session_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${SESSION_LINK})`,
            values: [
              run.id,
              run.name,
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
              run.sessionId,
            ],
          },
          ...points.map((p) => ({
            statement: `INSERT INTO track_points (run_id, segment, timestamp, lat, lon, accuracy, altitude, speed)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            values: [
              run.id,
              p.segment,
              p.timestamp,
              p.lat,
              p.lon,
              p.accuracy ?? null,
              p.altitude ?? null,
              p.speed ?? null,
            ],
          })),
          ...steps.map((step) => insertStep(run.id, step)),
        ],
        true,
      )
      return true
    },
    async saveStepChange(runId, ended, started) {
      const set = started.map((step) => insertStep(runId, step))
      if (ended) {
        set.unshift({
          statement: `UPDATE run_steps SET ended_elapsed_ms = ?, ended_distance_m = ?
           WHERE run_id = ? AND position = ?`,
          values: [ended.endedElapsedMs, ended.endedDistanceM, runId, ended.position],
        })
      }
      // One transaction, so a step never ends without the next one starting
      if (set.length > 0) await db.executeSet(set, true)
    },
    async loadRunSteps(runId) {
      const result = await db.query('SELECT * FROM run_steps WHERE run_id = ? ORDER BY position', [
        runId,
      ])
      return (result.values ?? []).map(toRunStep)
    },
    async readOverviews() {
      const result = await db.query(
        `SELECT o.run_id, o.algo, o.lines, o.bounds FROM route_overview o
         JOIN runs r ON r.id = o.run_id WHERE r.status = 'finished'`,
      )
      return (result.values ?? []).map(toRouteOverview)
    },
    async doneSessionIds() {
      const result = await db.query(
        `SELECT session_id FROM runs WHERE status = 'finished' AND session_id IS NOT NULL`,
      )
      return (result.values ?? []).map((row) => String(row.session_id))
    },
    async saveOverview(o) {
      await db.run(
        `INSERT OR REPLACE INTO route_overview (run_id, algo, lines, bounds) VALUES (?, ?, ?, ?)`,
        [o.runId, o.algo, JSON.stringify(o.lines), o.bounds ? JSON.stringify(o.bounds) : null],
      )
    },
  }
}
