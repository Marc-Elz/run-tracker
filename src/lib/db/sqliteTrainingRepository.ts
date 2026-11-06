import type {
  ProgramBundle,
  ProgramSession,
  ProgramSummary,
  SessionStep,
  SessionType,
  StepKind,
  TargetKind,
  TrainingProgram,
} from '@/lib/training'
import type { SqlConnection } from './migrations'
import type { TrainingRepository } from './trainingRepository'

type Row = Record<string, unknown>
type Statement = { statement: string; values: unknown[] }

const text = (v: unknown) => (v === null || v === undefined ? null : String(v))
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export function toProgram(row: Row): TrainingProgram {
  return {
    id: String(row.id),
    name: String(row.name),
    goal: text(row.goal),
    weeks: Number(row.weeks),
    startDate: text(row.start_date),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function toSession(row: Row): ProgramSession {
  return {
    id: String(row.id),
    programId: String(row.program_id),
    week: Number(row.week),
    position: Number(row.position),
    type: row.type as SessionType,
    title: String(row.title),
    notes: text(row.notes),
  }
}

export function toStep(row: Row): SessionStep {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    position: Number(row.position),
    kind: row.kind as StepKind,
    targetKind: row.target_kind as TargetKind,
    targetValue: num(row.target_value),
    paceMin: num(row.pace_min),
    paceMax: num(row.pace_max),
    repetitions: num(row.repetitions),
    span: num(row.span),
  }
}

const insertProgram = (p: TrainingProgram): Statement => ({
  statement: `INSERT INTO training_programs (id, name, goal, weeks, start_date, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
  values: [p.id, p.name, p.goal, p.weeks, p.startDate, p.createdAt, p.updatedAt],
})

const INSERT_SESSION = `INSERT INTO program_sessions (id, program_id, week, position, type, title, notes)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
const sessionValues = (s: ProgramSession) => [
  s.id,
  s.programId,
  s.week,
  s.position,
  s.type,
  s.title,
  s.notes,
]

/** On import a session id must be new: a clash fails the transaction */
const insertSession = (s: ProgramSession): Statement => ({
  statement: INSERT_SESSION,
  values: sessionValues(s),
})

/** Adds the session or edits it in place; it never moves to another program */
const upsertSession = (s: ProgramSession): Statement => ({
  statement: `${INSERT_SESSION}
   ON CONFLICT (id) DO UPDATE SET week = excluded.week, position = excluded.position,
     type = excluded.type, title = excluded.title, notes = excluded.notes
   WHERE program_id = excluded.program_id`,
  values: sessionValues(s),
})

const insertStep = (s: SessionStep): Statement => ({
  statement: `INSERT INTO session_steps (id, session_id, position, kind, target_kind, target_value,
     pace_min, pace_max, repetitions, span)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  values: [
    s.id,
    s.sessionId,
    s.position,
    s.kind,
    s.targetKind,
    s.targetValue,
    s.paceMin,
    s.paceMax,
    s.repetitions,
    s.span,
  ],
})

/** Moves a program's updated_at forward, always past its old value (see `nextUpdatedAt`) */
const touchProgram = (programId: string): Statement => ({
  statement: 'UPDATE training_programs SET updated_at = MAX(?, updated_at + 1) WHERE id = ?',
  values: [Date.now(), programId],
})

const touchProgramOfSession = (sessionId: string): Statement => ({
  statement: `UPDATE training_programs SET updated_at = MAX(?, updated_at + 1)
   WHERE id = (SELECT program_id FROM program_sessions WHERE id = ?)`,
  values: [Date.now(), sessionId],
})

/**
 * Training programs on the app database (opened by `openDb`). A write that touches a session
 * or its steps goes in one transaction with the program's `updated_at`.
 */
export function createSqliteTrainingRepository(db: SqlConnection): TrainingRepository {
  const rows = async (sql: string, values: unknown[] = []) =>
    (await db.query(sql, values)).values ?? []

  return {
    async listPrograms() {
      const result = await rows(
        `SELECT p.*, (SELECT COUNT(*) FROM program_sessions s WHERE s.program_id = p.id)
           AS session_count
         FROM training_programs p ORDER BY p.created_at DESC`,
      )
      return result.map((row): ProgramSummary => ({
        ...toProgram(row),
        sessionCount: Number(row.session_count),
      }))
    },
    async getProgram(id) {
      const [row] = await rows('SELECT * FROM training_programs WHERE id = ?', [id])
      return row ? toProgram(row) : null
    },
    async createProgram(program) {
      const { statement, values } = insertProgram(program)
      await db.run(statement, values)
    },
    async updateProgram(p) {
      await db.run(
        `UPDATE training_programs SET name = ?, goal = ?, weeks = ?, start_date = ?,
           updated_at = MAX(?, updated_at + 1)
         WHERE id = ?`,
        [p.name, p.goal, p.weeks, p.startDate, Date.now(), p.id],
      )
    },
    async deleteProgram(id) {
      // Sessions and their steps go with it (ON DELETE CASCADE; the plugin turns foreign keys on)
      await db.run('DELETE FROM training_programs WHERE id = ?', [id])
    },
    async listSessions(programId) {
      const result = await rows(
        'SELECT * FROM program_sessions WHERE program_id = ? ORDER BY week, position',
        [programId],
      )
      return result.map(toSession)
    },
    async getSession(id) {
      const [row] = await rows('SELECT * FROM program_sessions WHERE id = ?', [id])
      return row ? toSession(row) : null
    },
    async saveSession(session) {
      await db.executeSet([upsertSession(session), touchProgram(session.programId)], true)
    },
    async deleteSession(id) {
      // The touch goes first: after the delete the session can't lead to its program
      await db.executeSet(
        [
          touchProgramOfSession(id),
          { statement: 'DELETE FROM program_sessions WHERE id = ?', values: [id] },
        ],
        true,
      )
    },
    async loadSteps(sessionId) {
      const result = await rows(
        'SELECT * FROM session_steps WHERE session_id = ? ORDER BY position',
        [sessionId],
      )
      return result.map(toStep)
    },
    async replaceSteps(sessionId, steps) {
      await db.executeSet(
        [
          { statement: 'DELETE FROM session_steps WHERE session_id = ?', values: [sessionId] },
          ...steps.map((s) => insertStep({ ...s, sessionId })),
          touchProgramOfSession(sessionId),
        ],
        true,
      )
    },
    async exportPrograms() {
      const programs = (await rows('SELECT * FROM training_programs ORDER BY created_at')).map(
        toProgram,
      )
      const sessions = (
        await rows('SELECT * FROM program_sessions ORDER BY program_id, week, position')
      ).map(toSession)
      const steps = (await rows('SELECT * FROM session_steps ORDER BY session_id, position')).map(
        toStep,
      )
      return programs.map((program): ProgramBundle => {
        const own = sessions.filter((s) => s.programId === program.id)
        const ids = new Set(own.map((s) => s.id))
        return { program, sessions: own, steps: steps.filter((st) => ids.has(st.sessionId)) }
      })
    },
    async importProgram({ program, sessions, steps }) {
      const [existing] = await rows('SELECT id FROM training_programs WHERE id = ?', [program.id])
      if (existing) return false
      // One transaction: either the whole program is stored or none of it
      await db.executeSet(
        [insertProgram(program), ...sessions.map(insertSession), ...steps.map(insertStep)],
        true,
      )
      return true
    },
  }
}
