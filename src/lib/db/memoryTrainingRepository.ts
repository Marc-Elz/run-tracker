import type { ProgramBundle, ProgramSession, SessionStep, TrainingProgram } from '@/lib/training'
import { nextUpdatedAt, type TrainingRepository } from './trainingRepository'

const bySessionOrder = (a: ProgramSession, b: ProgramSession) =>
  a.week - b.week || a.position - b.position

/** Keeps programs in memory: used in the browser and in unit tests. */
export function createMemoryTrainingRepository(): TrainingRepository {
  const programs = new Map<string, TrainingProgram>()
  const sessions = new Map<string, ProgramSession>()
  const steps = new Map<string, SessionStep[]>()
  const skips = new Set<string>()

  const touch = (programId: string) => {
    const program = programs.get(programId)
    if (program) program.updatedAt = nextUpdatedAt(program.updatedAt)
  }
  const sessionsOf = (programId: string) =>
    [...sessions.values()].filter((s) => s.programId === programId).sort(bySessionOrder)
  const dropSession = (id: string) => {
    sessions.delete(id)
    steps.delete(id)
    skips.delete(id)
  }

  return {
    async listPrograms() {
      return [...programs.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((p) => ({ ...p, sessionCount: sessionsOf(p.id).length }))
    },
    async getProgram(id) {
      const program = programs.get(id)
      return program ? { ...program } : null
    },
    async createProgram(program) {
      if (programs.has(program.id)) throw new Error(`Program ${program.id} already exists`)
      programs.set(program.id, { ...program })
    },
    async updateProgram(program) {
      const old = programs.get(program.id)
      if (!old) throw new Error(`Program ${program.id} not found`)
      programs.set(program.id, {
        ...program,
        createdAt: old.createdAt,
        updatedAt: nextUpdatedAt(old.updatedAt),
      })
    },
    async deleteProgram(id) {
      for (const s of sessionsOf(id)) dropSession(s.id)
      programs.delete(id)
    },
    async listSessions(programId) {
      return sessionsOf(programId).map((s) => ({ ...s }))
    },
    async getSession(id) {
      const session = sessions.get(id)
      return session ? { ...session } : null
    },
    async saveSession(session) {
      if (!programs.has(session.programId)) {
        throw new Error(`Program ${session.programId} not found`)
      }
      sessions.set(session.id, { ...session })
      if (session.type === 'rest') {
        steps.delete(session.id)
        skips.delete(session.id)
      }
      touch(session.programId)
    },
    async deleteSession(id) {
      const session = sessions.get(id)
      dropSession(id)
      if (session) touch(session.programId)
    },
    async loadSteps(sessionId) {
      return (steps.get(sessionId) ?? []).map((s) => ({ ...s }))
    },
    async replaceSteps(sessionId, list) {
      const session = sessions.get(sessionId)
      if (!session) throw new Error(`Session ${sessionId} not found`)
      steps.set(
        sessionId,
        list.map((s) => ({ ...s, sessionId })).sort((a, b) => a.position - b.position),
      )
      touch(session.programId)
    },
    async skippedSessionIds() {
      return [...skips].sort()
    },
    async setSkipped(sessionId, skipped) {
      const session = sessions.get(sessionId)
      if (!session) return
      if (skipped) skips.add(sessionId)
      else skips.delete(sessionId)
      touch(session.programId)
    },
    async exportPrograms() {
      return [...programs.values()]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((program) => {
          const list = sessionsOf(program.id)
          const bundle: ProgramBundle = {
            program: { ...program },
            sessions: list.map((s) => ({ ...s })),
            steps: list.flatMap((s) => (steps.get(s.id) ?? []).map((st) => ({ ...st }))),
          }
          const skippedIds = list.filter((s) => skips.has(s.id)).map((s) => s.id)
          if (skippedIds.length > 0) bundle.skipped = skippedIds
          return bundle
        })
    },
    async importProgram({ program, sessions: imported, steps: importedSteps, skipped = [] }) {
      if (programs.has(program.id)) return 'exists'
      const stepIds = new Set([...steps.values()].flat().map((s) => s.id))
      if (
        imported.some((s) => sessions.has(s.id)) ||
        importedSteps.some((s) => stepIds.has(s.id))
      ) {
        return 'clash'
      }
      programs.set(program.id, { ...program })
      for (const s of imported) {
        sessions.set(s.id, { ...s })
        steps.set(
          s.id,
          importedSteps
            .filter((st) => st.sessionId === s.id)
            .map((st) => ({ ...st }))
            .sort((a, b) => a.position - b.position),
        )
      }
      for (const id of skipped) if (imported.some((s) => s.id === id)) skips.add(id)
      return 'added'
    },
  }
}
