import { Capacitor } from '@capacitor/core'
import type { TrackPoint } from '@/lib/geo'
import { createMemoryRunRepository } from './memoryRunRepository'

export type StoredRunStatus = 'running' | 'paused' | 'finished'

/** A run as saved; distance and moving time are a cache, the raw points are the truth */
export interface RunRecord {
  /** UUID made on the phone, so the run keeps its identity when synced later */
  id: string
  status: StoredRunStatus
  startedAt: number
  finishedAt: number | null
  /** Time banked from closed segments; excludes pauses */
  elapsedMs: number
  /** Index of the last segment opened (start = 0, +1 per resume), with or without fixes */
  segment: number
  /** Start of the open segment while running, otherwise null */
  segmentStartedAt: number | null
  movingMs: number
  distanceM: number
}

export interface StoredPoint extends TrackPoint {
  segment: number
}

export interface RunRepository {
  createRun(run: RunRecord): Promise<void>
  updateRun(run: RunRecord): Promise<void>
  addPoint(runId: string, segment: number, point: TrackPoint): Promise<void>
  /** Deletes the run and its points */
  deleteRun(id: string): Promise<void>
  /** Runs that never got to Stop, newest first */
  findUnfinished(): Promise<RunRecord[]>
  /** One run, or null when there is none with this id */
  getRun(id: string): Promise<RunRecord | null>
  /** Finished runs, newest first */
  listFinished(): Promise<RunRecord[]>
  /** Points of a run in recording order */
  loadPoints(runId: string): Promise<StoredPoint[]>
}

/** Run every call strictly after the previous one finished, so writes land in order. */
export function serialized(repo: RunRepository): RunRepository {
  let tail: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(op: () => Promise<T>): Promise<T> => {
    const next = tail.then(op)
    tail = next.catch(() => {})
    return next
  }
  return {
    createRun: (run) => enqueue(() => repo.createRun(run)),
    updateRun: (run) => enqueue(() => repo.updateRun(run)),
    addPoint: (runId, segment, point) => enqueue(() => repo.addPoint(runId, segment, point)),
    deleteRun: (id) => enqueue(() => repo.deleteRun(id)),
    findUnfinished: () => enqueue(() => repo.findUnfinished()),
    getRun: (id) => enqueue(() => repo.getRun(id)),
    listFinished: () => enqueue(() => repo.listFinished()),
    loadPoints: (runId) => enqueue(() => repo.loadPoints(runId)),
  }
}

/** Stand-in when the database could not be opened: every call fails, so the run shows "Not saving". */
export function unavailableRunRepository(cause: unknown): RunRepository {
  const fail = async (): Promise<never> => {
    throw new Error(`Database unavailable: ${String(cause)}`)
  }
  return {
    createRun: fail,
    updateRun: fail,
    addPoint: fail,
    deleteRun: fail,
    findUnfinished: fail,
    getRun: fail,
    listFinished: fail,
    loadPoints: fail,
  }
}

/** SQLite on the phone; in memory in the browser, where nothing needs to survive a reload. */
export async function openRunRepository(): Promise<RunRepository> {
  if (!Capacitor.isNativePlatform()) return createMemoryRunRepository()
  const { openSqliteRunRepository } = await import('./sqliteRunRepository')
  return serialized(await openSqliteRunRepository())
}
