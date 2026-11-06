import { defineStore } from 'pinia'
import {
  checkProgram,
  checkSession,
  checkSteps,
  checkWeeksKeepSessions,
  TrainingError,
  type ProgramBundle,
  type ProgramInput,
  type ProgramSession,
  type SessionInput,
  type SessionStep,
  type TrainingProgram,
} from '@/lib/training'
import type { TrainingRepository } from '@/lib/db/trainingRepository'
import { createMemoryTrainingRepository } from '@/lib/db/memoryTrainingRepository'

/**
 * Training programs: the rules from `lib/training` applied before every write, ids and times
 * made here. The screens load what they show themselves, as History does, so the store holds
 * no copies that could go stale.
 */
export const useTrainingStore = defineStore('training', () => {
  let repo: TrainingRepository = createMemoryTrainingRepository()

  function useRepository(r: TrainingRepository) {
    repo = r
  }

  async function requireProgram(id: string): Promise<TrainingProgram> {
    const program = await repo.getProgram(id)
    if (!program) throw new TrainingError('This program no longer exists.')
    return program
  }

  async function createProgram(input: ProgramInput): Promise<string> {
    const checked = checkProgram(input)
    const now = Date.now()
    const id = crypto.randomUUID()
    await repo.createProgram({ id, ...checked, createdAt: now, updatedAt: now })
    return id
  }

  async function updateProgram(id: string, input: ProgramInput) {
    const checked = checkProgram(input)
    const program = await requireProgram(id)
    checkWeeksKeepSessions(checked.weeks, await repo.listSessions(id))
    await repo.updateProgram({ ...program, ...checked })
  }

  /**
   * Adds a session at the end of its week, or edits one. A session moved to another week goes
   * to the end of that week.
   */
  async function saveSession(programId: string, input: SessionInput, id?: string): Promise<string> {
    const program = await requireProgram(programId)
    const checked = checkSession(input, program.weeks)
    const sessions = await repo.listSessions(programId)
    const existing = id === undefined ? undefined : sessions.find((s) => s.id === id)
    if (id !== undefined && !existing) throw new TrainingError('This session no longer exists.')
    const position =
      existing && existing.week === checked.week
        ? existing.position
        : Math.max(-1, ...sessions.filter((s) => s.week === checked.week).map((s) => s.position)) +
          1
    const session: ProgramSession = {
      id: existing?.id ?? crypto.randomUUID(),
      programId,
      position,
      ...checked,
    }
    // A rest day loses its steps in the same write (see TrainingRepository.saveSession)
    await repo.saveSession(session)
    return session.id
  }

  async function replaceSteps(sessionId: string, steps: SessionStep[]) {
    const ordered = steps.map((s, position) => ({ ...s, sessionId, position }))
    checkSteps(ordered)
    await repo.replaceSteps(sessionId, ordered)
  }

  return {
    useRepository,
    listPrograms: () => repo.listPrograms(),
    getProgram: (id: string) => repo.getProgram(id),
    createProgram,
    updateProgram,
    deleteProgram: (id: string) => repo.deleteProgram(id),
    listSessions: (programId: string) => repo.listSessions(programId),
    getSession: (id: string) => repo.getSession(id),
    saveSession,
    deleteSession: (id: string) => repo.deleteSession(id),
    loadSteps: (sessionId: string) => repo.loadSteps(sessionId),
    replaceSteps,
    exportPrograms: () => repo.exportPrograms(),
    importProgram: (bundle: ProgramBundle) => repo.importProgram(bundle),
  }
})
