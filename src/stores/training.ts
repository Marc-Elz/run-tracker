import { defineStore } from 'pinia'
import {
  checkProgram,
  checkSession,
  checkSteps,
  checkWeeksKeepSessions,
  fromBlocks,
  toBlocks,
  TrainingError,
  type StepBlock,
  type ProgramBundle,
  type ProgramInput,
  type ProgramSession,
  type SessionInput,
  type SessionStep,
  type TrainingProgram,
} from '@/lib/training'
import type { TrainingRepository } from '@/lib/db/trainingRepository'
import { createMemoryTrainingRepository } from '@/lib/db/memoryTrainingRepository'
import { followedProgramId, setFollowedProgram } from '@/lib/settings'

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

  /** Deletes the program; its runs stay, unlinked. Stops following it when it was followed. */
  async function deleteProgram(id: string) {
    await repo.deleteProgram(id)
    if (followedProgramId.value === id) setFollowedProgram(null)
  }

  async function replaceSteps(sessionId: string, steps: SessionStep[]) {
    const ordered = steps.map((s, position) => ({ ...s, sessionId, position }))
    checkSteps(ordered)
    await repo.replaceSteps(sessionId, ordered)
  }

  /** The skipped sessions of every program (#102) */
  const skippedSessionIds = () => repo.skippedSessionIds()

  /** Mark a session skipped or clear it. A rest day has nothing to skip. */
  async function setSkipped(sessionId: string, skipped: boolean) {
    const session = await repo.getSession(sessionId)
    if (!session) throw new TrainingError('This session no longer exists.')
    if (session.type === 'rest') throw new TrainingError('A rest day cannot be skipped.')
    await repo.setSkipped(sessionId, skipped)
  }

  /**
   * Store a session's steps as the editor holds them. Every step change (drag, step editor,
   * delete) writes the whole list at once, so the screen and storage can't drift apart.
   */
  async function saveBlocks(sessionId: string, blocks: StepBlock[]) {
    if (!(await repo.getSession(sessionId))) {
      throw new TrainingError('This session no longer exists.')
    }
    await replaceSteps(sessionId, fromBlocks(sessionId, blocks))
  }

  async function loadBlocks(sessionId: string): Promise<StepBlock[]> {
    return toBlocks(await repo.loadSteps(sessionId))
  }

  return {
    useRepository,
    listPrograms: () => repo.listPrograms(),
    getProgram: (id: string) => repo.getProgram(id),
    createProgram,
    updateProgram,
    deleteProgram,
    listSessions: (programId: string) => repo.listSessions(programId),
    getSession: (id: string) => repo.getSession(id),
    saveSession,
    deleteSession: (id: string) => repo.deleteSession(id),
    loadSteps: (sessionId: string) => repo.loadSteps(sessionId),
    loadProgramSteps: (programId: string) => repo.loadProgramSteps(programId),
    skippedSessionIds,
    setSkipped,
    replaceSteps,
    saveBlocks,
    loadBlocks,
    exportPrograms: () => repo.exportPrograms(),
    importProgram: (bundle: ProgramBundle) => repo.importProgram(bundle),
  }
})
