import type {
  ProgramBundle,
  ProgramSession,
  ProgramSummary,
  SessionStep,
  TrainingProgram,
} from '@/lib/training'
import { createQueue, type Queue } from './runRepository'

/**
 * Storage of training programs. Checks of the rules (weeks, titles, steps) happen in the store
 * before a write, so this only stores. Every write to a session or its steps also moves the
 * program's `updatedAt` forward, so a backup notices any change inside a program.
 */
export interface TrainingRepository {
  /** All programs with their session count, newest first */
  listPrograms(): Promise<ProgramSummary[]>
  getProgram(id: string): Promise<TrainingProgram | null>
  createProgram(program: TrainingProgram): Promise<void>
  /** Name, goal, weeks and start date; `updatedAt` is set here */
  updateProgram(program: TrainingProgram): Promise<void>
  /** Deletes the program with its sessions and their steps */
  deleteProgram(id: string): Promise<void>
  /** Sessions of a program by week, then position */
  listSessions(programId: string): Promise<ProgramSession[]>
  getSession(id: string): Promise<ProgramSession | null>
  /** Adds the session, or replaces it when its id exists; a rest day loses its steps in the same write */
  saveSession(session: ProgramSession): Promise<void>
  /** Deletes the session and its steps */
  deleteSession(id: string): Promise<void>
  /** Steps of a session in order */
  loadSteps(sessionId: string): Promise<SessionStep[]>
  /** Steps of every session of a program in one read, by session id, each in order (#138) */
  loadProgramSteps(programId: string): Promise<Map<string, SessionStep[]>>
  /** Replaces all steps of a session in one transaction */
  replaceSteps(sessionId: string, steps: SessionStep[]): Promise<void>
  /** Sessions marked skipped (#102), in every program */
  skippedSessionIds(): Promise<string[]>
  /** Marks a session skipped or clears it; does nothing for a session that does not exist */
  setSkipped(sessionId: string, skipped: boolean): Promise<void>
  /** Every program with its sessions and steps, oldest first (for a backup) */
  exportPrograms(): Promise<ProgramBundle[]>
  /**
   * Store a program with its sessions and steps as one unit, keeping its times. Writes nothing
   * and says why when the program is already here ('exists') or one of its session or step ids
   * belongs to something else on this phone ('clash'). A thrown error is a real storage failure.
   */
  importProgram(bundle: ProgramBundle): Promise<ImportOutcome>
}

export type ImportOutcome = 'added' | 'exists' | 'clash'

/** `updatedAt` for a write: now, but always later than the value before */
export const nextUpdatedAt = (previous: number, now = Date.now()) => Math.max(now, previous + 1)

/** Run every call strictly after the previous one on this queue finished */
export function serializedTraining(
  repo: TrainingRepository,
  enqueue: Queue = createQueue(),
): TrainingRepository {
  return {
    listPrograms: () => enqueue(() => repo.listPrograms()),
    getProgram: (id) => enqueue(() => repo.getProgram(id)),
    createProgram: (p) => enqueue(() => repo.createProgram(p)),
    updateProgram: (p) => enqueue(() => repo.updateProgram(p)),
    deleteProgram: (id) => enqueue(() => repo.deleteProgram(id)),
    listSessions: (programId) => enqueue(() => repo.listSessions(programId)),
    getSession: (id) => enqueue(() => repo.getSession(id)),
    saveSession: (s) => enqueue(() => repo.saveSession(s)),
    deleteSession: (id) => enqueue(() => repo.deleteSession(id)),
    loadSteps: (sessionId) => enqueue(() => repo.loadSteps(sessionId)),
    loadProgramSteps: (programId) => enqueue(() => repo.loadProgramSteps(programId)),
    replaceSteps: (sessionId, steps) => enqueue(() => repo.replaceSteps(sessionId, steps)),
    skippedSessionIds: () => enqueue(() => repo.skippedSessionIds()),
    setSkipped: (sessionId, skipped) => enqueue(() => repo.setSkipped(sessionId, skipped)),
    exportPrograms: () => enqueue(() => repo.exportPrograms()),
    importProgram: (bundle) => enqueue(() => repo.importProgram(bundle)),
  }
}

/** Stand-in when the database could not be opened: every call fails, and the screens say so */
export function unavailableTrainingRepository(cause: unknown): TrainingRepository {
  const fail = async (): Promise<never> => {
    throw new Error(`Database unavailable: ${String(cause)}`)
  }
  return {
    listPrograms: fail,
    getProgram: fail,
    createProgram: fail,
    updateProgram: fail,
    deleteProgram: fail,
    listSessions: fail,
    getSession: fail,
    saveSession: fail,
    deleteSession: fail,
    loadSteps: fail,
    loadProgramSteps: fail,
    replaceSteps: fail,
    skippedSessionIds: fail,
    setSkipped: fail,
    exportPrograms: fail,
    importProgram: fail,
  }
}
