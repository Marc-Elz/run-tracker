import type { RunRecord, StoredPoint } from '@/lib/db/runRepository'

/**
 * The backup file, version 1. One JSON object:
 *   { format: 'run-tracker-backup', version: 1, exportedAt: <epoch ms>,
 *     runs: [{ run: RunRecord, points: StoredPoint[] }] }
 * Only finished runs are in it. Field names are the ones of `RunRecord` and `StoredPoint`; times
 * are UTC epoch milliseconds. The sync to the home server (#24) builds on this format, so a change
 * that old files cannot satisfy needs a new `version`.
 */
export const BACKUP_FORMAT = 'run-tracker-backup'
export const BACKUP_VERSION = 1

export interface BackupRun {
  run: RunRecord
  points: StoredPoint[]
}

export interface ParsedBackup {
  runs: BackupRun[]
  /** Runs in the file that were malformed and left out */
  rejected: number
}

/** The file as a whole cannot be used; the message says why in words for the user. */
export class BackupError extends Error {}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Changes whenever a backup of these runs would differ: a run added, deleted or renamed, or a new
 * day. Saved runs do not otherwise change, so an equal key means the same file content.
 */
export const backupKey = (fileName: string, runs: RunRecord[]) =>
  JSON.stringify([fileName, runs.map((r) => [r.id, r.name, r.finishedAt, r.distanceM, r.movingMs])])

/** "run-tracker-backup-2026-10-28.json", local date */
export function backupFileName(now: number): string {
  const d = new Date(now)
  return `run-tracker-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`
}

/**
 * The file as pieces that join to one JSON text: header, one piece per run (with its separator),
 * footer. Writing them one by one keeps a large backup from ever being one huge string.
 */
export const backupHeader = (now: number) =>
  `{"format":"${BACKUP_FORMAT}","version":${BACKUP_VERSION},"exportedAt":${now},"runs":[`
export const backupRunPiece = (entry: BackupRun, index: number) =>
  (index > 0 ? ',' : '') + JSON.stringify(entry)
export const BACKUP_FOOTER = ']}'

/** The file text for these runs (compact: a backup of many runs is large). */
export function buildBackup(runs: BackupRun[], now: number): string {
  return backupHeader(now) + runs.map(backupRunPiece).join('') + BACKUP_FOOTER
}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isCount = (v: unknown): v is number => isNumber(v) && Number.isInteger(v) && v >= 0
const isNonNegative = (v: unknown): v is number => isNumber(v) && v >= 0
const optionalNumber = (v: unknown) => v === undefined || isNumber(v)

function toPoint(raw: unknown): StoredPoint | null {
  if (!isObject(raw)) return null
  const { lat, lon, timestamp, segment, accuracy, altitude, speed } = raw
  if (!isNumber(lat) || lat < -90 || lat > 90) return null
  if (!isNumber(lon) || lon < -180 || lon > 180) return null
  if (!isNumber(timestamp) || !isCount(segment)) return null
  if (!optionalNumber(accuracy) || !optionalNumber(altitude) || !optionalNumber(speed)) return null
  const point: StoredPoint = { segment, timestamp, lat, lon }
  if (accuracy !== undefined) point.accuracy = accuracy as number
  if (altitude !== undefined) point.altitude = altitude as number
  if (speed !== undefined) point.speed = speed as number
  return point
}

function toRun(raw: unknown): RunRecord | null {
  if (!isObject(raw)) return null
  const { id, name, startedAt, finishedAt, elapsedMs, segment, movingMs, distanceM } = raw
  if (typeof id !== 'string' || id === '') return null
  if (name !== null && typeof name !== 'string') return null
  if (!isNumber(startedAt) || !isNumber(finishedAt)) return null
  if (!isCount(segment)) return null
  if (!isNonNegative(elapsedMs) || !isNonNegative(movingMs) || !isNonNegative(distanceM)) return null
  return {
    id,
    name,
    status: 'finished',
    startedAt,
    finishedAt,
    elapsedMs,
    segment,
    segmentStartedAt: null,
    movingMs,
    distanceM,
  }
}

/**
 * Read a backup file. Throws `BackupError` when the file as a whole is not usable (not JSON, not
 * ours, from a newer app, or holding a run that never finished); a single malformed run is
 * left out and counted instead. Nothing is written here.
 */
export function parseBackup(text: string): ParsedBackup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new BackupError('This file is not a Run Tracker backup (it is not valid JSON).')
  }
  if (!isObject(data) || data.format !== BACKUP_FORMAT || !Array.isArray(data.runs)) {
    throw new BackupError('This file is not a Run Tracker backup.')
  }
  if (!isCount(data.version) || data.version < 1) {
    throw new BackupError('This backup has no valid version.')
  }
  if (data.version > BACKUP_VERSION) {
    throw new BackupError('This backup was made by a newer version of the app. Update the app first.')
  }

  const runs: BackupRun[] = []
  let rejected = 0
  for (const entry of data.runs) {
    const status = isObject(entry) && isObject(entry.run) ? entry.run.status : undefined
    if (status === 'running' || status === 'paused') {
      throw new BackupError('This backup contains a run that was never finished, so it was not restored.')
    }
    const run = isObject(entry) && status === 'finished' ? toRun(entry.run) : null
    const rawPoints = isObject(entry) ? entry.points : undefined
    const points = Array.isArray(rawPoints) ? rawPoints.map(toPoint) : null
    if (run === null || points === null || points.some((p) => p === null)) {
      rejected++
      continue
    }
    runs.push({ run, points: points as StoredPoint[] })
  }
  return { runs, rejected }
}
