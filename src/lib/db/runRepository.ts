import type { TrackPoint } from '@/lib/geo'
import type { RouteOverview } from '@/lib/routeOverview'

export type StoredRunStatus = 'running' | 'paused' | 'finished'

/** A run as saved; distance and moving time are a cache, the raw points are the truth */
export interface RunRecord {
  /** UUID made on the phone, so the run keeps its identity when synced later */
  id: string
  /** The user's name for the run, null while it has none */
  name: string | null
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
  /** The training session the run was started from (#40), null for a free run */
  sessionId: string | null
}

export interface StoredPoint extends TrackPoint {
  segment: number
}

export interface RunRepository {
  /**
   * Resolves with the session link as stored: null when the run's session no longer exists or
   * already has a run, so a link problem never stops a run from being saved.
   */
  createRun(run: RunRecord): Promise<string | null>
  updateRun(run: RunRecord): Promise<void>
  addPoint(runId: string, segment: number, point: TrackPoint): Promise<void>
  /** Sets or clears (null) the name; the rest of the run is untouched */
  renameRun(id: string, name: string | null): Promise<void>
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
  /**
   * Store a finished run with its name and all its points as one unit, points in the given order.
   * Returns false and writes nothing when a run with this id already exists. The session link is
   * kept only when that session exists and has no run yet, as in `createRun`.
   */
  importRun(run: RunRecord, points: StoredPoint[]): Promise<boolean>
  /** Stored route overviews of finished runs (a cache; see `loadRouteOverviews`) */
  readOverviews(): Promise<RouteOverview[]>
  /** Stores or replaces the overview of a run */
  saveOverview(overview: RouteOverview): Promise<void>
  /** Sessions that have a finished run: the done sessions of every program */
  doneSessionIds(): Promise<string[]>
}

/** Runs each operation strictly after the previous one finished */
export type Queue = <T>(op: () => Promise<T>) => Promise<T>

/**
 * One queue for every repository on the same connection, so a training program write never
 * interleaves with the writes of a run in progress.
 */
export function createQueue(): Queue {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(op: () => Promise<T>): Promise<T> => {
    const next = tail.then(op)
    tail = next.catch(() => {})
    return next
  }
}

/** Run every call strictly after the previous one on this queue finished, so writes land in order. */
export function serialized(repo: RunRepository, enqueue: Queue = createQueue()): RunRepository {
  return {
    createRun: (run) => enqueue(() => repo.createRun(run)),
    updateRun: (run) => enqueue(() => repo.updateRun(run)),
    addPoint: (runId, segment, point) => enqueue(() => repo.addPoint(runId, segment, point)),
    renameRun: (id, name) => enqueue(() => repo.renameRun(id, name)),
    deleteRun: (id) => enqueue(() => repo.deleteRun(id)),
    findUnfinished: () => enqueue(() => repo.findUnfinished()),
    getRun: (id) => enqueue(() => repo.getRun(id)),
    listFinished: () => enqueue(() => repo.listFinished()),
    loadPoints: (runId) => enqueue(() => repo.loadPoints(runId)),
    importRun: (run, points) => enqueue(() => repo.importRun(run, points)),
    readOverviews: () => enqueue(() => repo.readOverviews()),
    saveOverview: (overview) => enqueue(() => repo.saveOverview(overview)),
    doneSessionIds: () => enqueue(() => repo.doneSessionIds()),
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
    renameRun: fail,
    deleteRun: fail,
    findUnfinished: fail,
    getRun: fail,
    listFinished: fail,
    loadPoints: fail,
    importRun: fail,
    readOverviews: fail,
    saveOverview: fail,
    doneSessionIds: fail,
  }
}
