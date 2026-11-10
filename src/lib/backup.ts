import type { RunRecord, StoredPoint } from '@/lib/db/runRepository'
import type { RunStep } from '@/lib/stepProgress'
import {
  checkProgram,
  checkSession,
  checkSteps,
  TrainingError,
  SESSION_TYPES,
  STEP_KINDS,
  TARGET_KINDS,
  dayNumber,
  type ProgramBundle,
  type ProgramSession,
  type SessionStep,
  type TrainingProgram,
} from '@/lib/training'

/**
 * The backup file, version 2. One JSON object:
 *   { format: 'run-tracker-backup', version: 2, exportedAt: <epoch ms>,
 *     runs: [{ run: RunRecord, points: StoredPoint[], steps?: RunStep[] }],
 *     programs: [{ program: TrainingProgram, sessions: ProgramSession[], steps: SessionStep[],
 *                  skipped?: string[] }] }
 * Only finished runs are in it. Field names are the ones of those types; times are UTC epoch
 * milliseconds. A run's `sessionId` (#40) links it to a session in `programs`; files made before
 * it have no `sessionId`, which reads as null. A run's `steps` (#101) are the session steps as
 * run; files made before them have none, which reads as an empty list. A program's `skipped`
 * (#102) lists its skipped session ids; files made before it have none, which reads as no skips.
 * Version 1 is the same without `programs`, and is
 * still read. The sync to the
 * home server (#24) builds on this format, so a change that old files cannot satisfy needs a new
 * `version`.
 */
export const BACKUP_FORMAT = 'run-tracker-backup'
export const BACKUP_VERSION = 2

export interface BackupRun {
  run: RunRecord
  points: StoredPoint[]
  /** Session steps as run (#101); missing means none */
  steps?: RunStep[]
}

export interface ParsedBackup {
  runs: BackupRun[]
  programs: ProgramBundle[]
  /** Runs and programs in the file that were malformed and left out */
  rejected: number
}

/** The file as a whole cannot be used; the message says why in words for the user. */
export class BackupError extends Error {}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Changes whenever a backup of these runs and programs would differ: a run added, deleted or
 * renamed, a program added, deleted or changed anywhere inside (its `updatedAt` moves on every
 * write), or a new day. Saved runs do not otherwise change, so an equal key means the same file
 * content.
 */
export const backupKey = (fileName: string, runs: RunRecord[], programs: TrainingProgram[]) =>
  JSON.stringify([
    fileName,
    runs.map((r) => [r.id, r.name, r.finishedAt, r.distanceM, r.movingMs, r.sessionId]),
    programs.map((p) => [p.id, p.updatedAt]),
  ])

/** "run-tracker-backup-2026-10-28.json", local date */
export function backupFileName(now: number): string {
  const d = new Date(now)
  return `run-tracker-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`
}

/**
 * The file as pieces that join to one JSON text: header, one piece per run (with its separator),
 * the switch to programs, one piece per program, footer. Writing them one by one keeps a large
 * backup from ever being one huge string.
 */
export const backupHeader = (now: number) =>
  `{"format":"${BACKUP_FORMAT}","version":${BACKUP_VERSION},"exportedAt":${now},"runs":[`
export const backupRunPiece = (entry: BackupRun, index: number) =>
  (index > 0 ? ',' : '') + JSON.stringify(entry)
export const BACKUP_PROGRAMS_START = '],"programs":['
export const backupProgramPiece = (bundle: ProgramBundle, index: number) =>
  (index > 0 ? ',' : '') + JSON.stringify(bundle)
export const BACKUP_FOOTER = ']}'

/** The file text for these runs and programs (compact: a backup of many runs is large). */
export function buildBackup(runs: BackupRun[], programs: ProgramBundle[], now: number): string {
  return (
    backupHeader(now) +
    runs.map(backupRunPiece).join('') +
    BACKUP_PROGRAMS_START +
    programs.map(backupProgramPiece).join('') +
    BACKUP_FOOTER
  )
}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isCount = (v: unknown): v is number => isNumber(v) && Number.isInteger(v) && v >= 0
const isNonNegative = (v: unknown): v is number => isNumber(v) && v >= 0
const optionalNumber = (v: unknown) => v === undefined || isNumber(v)
const isId = (v: unknown): v is string => typeof v === 'string' && v !== ''
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const isTextOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string'
const isNumberOrNull = (v: unknown): v is number | null => v === null || isNumber(v)
const isWhole = (v: unknown, min: number): v is number => isCount(v) && v >= min
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  (list as readonly unknown[]).includes(v)

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
  const { sessionId } = raw
  if (typeof id !== 'string' || id === '') return null
  if (sessionId !== undefined && sessionId !== null && !isId(sessionId)) return null
  if (name !== null && typeof name !== 'string') return null
  if (!isNumber(startedAt) || !isNumber(finishedAt)) return null
  if (!isCount(segment)) return null
  if (!isNonNegative(elapsedMs) || !isNonNegative(movingMs) || !isNonNegative(distanceM))
    return null
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
    sessionId: isId(sessionId) ? sessionId : null,
  }
}

const RUN_STEP_KINDS = STEP_KINDS.filter((k) => k !== 'repeat')
const isRoundOrNull = (v: unknown) => v === null || isWhole(v, 1)

function toRunStep(raw: unknown): RunStep | null {
  if (!isObject(raw)) return null
  const { position, kind, targetKind, targetValue, paceMin, paceMax } = raw
  const { repetition, repetitions, startedElapsedMs, startedDistanceM } = raw
  const { endedElapsedMs, endedDistanceM } = raw
  if (!isCount(position) || !oneOf(RUN_STEP_KINDS, kind) || !oneOf(TARGET_KINDS, targetKind)) {
    return null
  }
  if (![targetValue, paceMin, paceMax].every(isNumberOrNull)) return null
  if (!isRoundOrNull(repetition) || !isRoundOrNull(repetitions)) return null
  if (!isNonNegative(startedElapsedMs) || !isNonNegative(startedDistanceM)) return null
  const endOk = (v: unknown) => v === null || isNonNegative(v)
  if (!endOk(endedElapsedMs) || !endOk(endedDistanceM)) return null
  return {
    position,
    kind,
    targetKind,
    targetValue: targetValue as number | null,
    paceMin: paceMin as number | null,
    paceMax: paceMax as number | null,
    repetition: repetition as number | null,
    repetitions: repetitions as number | null,
    startedElapsedMs,
    startedDistanceM,
    endedElapsedMs: endedElapsedMs as number | null,
    endedDistanceM: endedDistanceM as number | null,
  }
}

/** A run's steps: none when the field is missing, null when any step is bad or a position repeats */
function toRunSteps(raw: unknown): RunStep[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return null
  const steps = raw.map(toRunStep)
  if (steps.some((s) => s === null)) return null
  const positions = new Set(steps.map((s) => s!.position))
  return positions.size === steps.length ? (steps as RunStep[]) : null
}

/** The result of a `lib/training` check, or null when the check refuses it */
function obeys<T>(check: () => T): T | null {
  try {
    return check()
  } catch (err) {
    if (err instanceof TrainingError) return null
    throw err
  }
}

function toProgram(raw: unknown): TrainingProgram | null {
  if (!isObject(raw)) return null
  const { id, name, goal, weeks, startDate, createdAt, updatedAt } = raw
  if (!isId(id) || !isText(name) || !isTextOrNull(goal) || !isWhole(weeks, 1)) return null
  if (startDate !== null && (typeof startDate !== 'string' || dayNumber(startDate) === null)) {
    return null
  }
  if (!isNumber(createdAt) || !isNumber(updatedAt)) return null
  // The same rules as a program entered in the app (weeks, lengths, trimming)
  const checked = obeys(() => checkProgram({ name, goal, weeks, startDate }))
  return checked && { id, ...checked, createdAt, updatedAt }
}

function toSession(raw: unknown, program: TrainingProgram): ProgramSession | null {
  if (!isObject(raw)) return null
  const { id, programId, week, position, type, title, notes } = raw
  if (!isId(id) || programId !== program.id) return null
  if (!isWhole(week, 1) || week > program.weeks || !isNumber(position)) return null
  if (!oneOf(SESSION_TYPES, type) || !isText(title) || !isTextOrNull(notes)) return null
  const checked = obeys(() => checkSession({ week, type, title, notes }, program.weeks))
  return checked && { id, programId, position, ...checked }
}

function toStep(raw: unknown, sessionIds: Set<string>): SessionStep | null {
  if (!isObject(raw)) return null
  const { id, sessionId, position, kind, targetKind, targetValue, paceMin, paceMax } = raw
  const { repetitions, span } = raw
  if (!isId(id) || typeof sessionId !== 'string' || !sessionIds.has(sessionId)) return null
  if (!isNumber(position) || !oneOf(STEP_KINDS, kind) || !oneOf(TARGET_KINDS, targetKind)) {
    return null
  }
  if (![targetValue, paceMin, paceMax, repetitions, span].every(isNumberOrNull)) return null
  return {
    id,
    sessionId,
    position,
    kind,
    targetKind,
    targetValue: targetValue as number | null,
    paceMin: paceMin as number | null,
    paceMax: paceMax as number | null,
    repetitions: repetitions as number | null,
    span: span as number | null,
  }
}

/**
 * A program with valid sessions and steps, or null. `seen` holds the ids of the programs,
 * sessions and steps accepted so far: an id used twice in one file would make the import fail on
 * the phone, so that program is left out instead.
 */
function toBundle(raw: unknown, seen: Set<string>): ProgramBundle | null {
  if (!isObject(raw) || !Array.isArray(raw.sessions) || !Array.isArray(raw.steps)) return null
  const program = toProgram(raw.program)
  if (program === null) return null
  const sessions = raw.sessions.map((s) => toSession(s, program))
  if (sessions.some((s) => s === null)) return null
  const sessionIds = new Set((sessions as ProgramSession[]).map((s) => s.id))
  const steps = raw.steps.map((s) => toStep(s, sessionIds))
  if (steps.some((s) => s === null)) return null
  const bundle: ProgramBundle = {
    program,
    sessions: sessions as ProgramSession[],
    steps: steps as SessionStep[],
  }
  // Skips of sessions that are not in this program are dropped, not a reason to reject it
  if (Array.isArray(raw.skipped)) {
    const skipped = [...new Set(raw.skipped)].filter(
      (id): id is string => typeof id === 'string' && sessionIds.has(id),
    )
    if (skipped.length > 0) bundle.skipped = skipped
  }
  const ids = [program.id, ...bundle.sessions.map((s) => s.id), ...bundle.steps.map((s) => s.id)]
  if (new Set(ids).size !== ids.length || ids.some((id) => seen.has(id))) return null
  for (const session of bundle.sessions) {
    const own = bundle.steps
      .filter((s) => s.sessionId === session.id)
      .sort((a, b) => a.position - b.position)
    if (obeys(() => checkSteps(own)) === null) return null
  }
  for (const id of ids) seen.add(id)
  return bundle
}

/**
 * Read a backup file. Throws `BackupError` when the file as a whole is not usable (not JSON, not
 * ours, from a newer app, or holding a run that never finished); a single malformed run or
 * program is left out and counted instead. Nothing is written here.
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
    throw new BackupError(
      'This backup was made by a newer version of the app. Update the app first.',
    )
  }
  // After the version: a newer app may store programs differently
  if (data.programs !== undefined && !Array.isArray(data.programs)) {
    throw new BackupError('This backup is damaged: its training programs cannot be read.')
  }

  const runs: BackupRun[] = []
  let rejected = 0
  for (const entry of data.runs) {
    const status = isObject(entry) && isObject(entry.run) ? entry.run.status : undefined
    if (status === 'running' || status === 'paused') {
      throw new BackupError(
        'This backup contains a run that was never finished, so it was not restored.',
      )
    }
    const run = isObject(entry) && status === 'finished' ? toRun(entry.run) : null
    const rawPoints = isObject(entry) ? entry.points : undefined
    const points = Array.isArray(rawPoints) ? rawPoints.map(toPoint) : null
    const steps = isObject(entry) ? toRunSteps(entry.steps) : null
    if (run === null || points === null || points.some((p) => p === null) || steps === null) {
      rejected++
      continue
    }
    runs.push({ run, points: points as StoredPoint[], steps })
  }

  const programs: ProgramBundle[] = []
  const seen = new Set<string>()
  for (const entry of (data.programs as unknown[] | undefined) ?? []) {
    const bundle = toBundle(entry, seen)
    if (bundle === null) rejected++
    else programs.push(bundle)
  }
  return { runs, programs, rejected }
}
