/**
 * Training programs as week/session templates (#95): a program has weeks 1..N, each week has
 * sessions in order, each session has structured steps. Sessions have no calendar date: the next
 * one not yet run is the one to do (#40), so a missed day needs no rescheduling.
 */

export const SESSION_TYPES = [
  'easy',
  'long',
  'intervals',
  'tempo',
  'free',
  'walk',
  'runwalk',
  'rest',
] as const
export type SessionType = (typeof SESSION_TYPES)[number]

export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  easy: 'Easy',
  long: 'Long',
  intervals: 'Intervals',
  tempo: 'Tempo',
  free: 'Free run',
  walk: 'Walk',
  runwalk: 'Run/walk',
  rest: 'Rest',
}

export const STEP_KINDS = ['warmup', 'run', 'walk', 'recovery', 'repeat', 'cooldown'] as const
export type StepKind = (typeof STEP_KINDS)[number]

export const STEP_KIND_LABELS: Record<StepKind, string> = {
  warmup: 'Warm-up',
  run: 'Run',
  walk: 'Walk',
  recovery: 'Recovery',
  repeat: 'Repeat',
  cooldown: 'Cool-down',
}

export const TARGET_KINDS = ['none', 'duration', 'distance'] as const
export type TargetKind = (typeof TARGET_KINDS)[number]

export const MAX_WEEKS = 52
export const MAX_NAME_LENGTH = 60
export const MAX_NOTES_LENGTH = 1000

export interface TrainingProgram {
  /** UUID made on the phone, like a run's */
  id: string
  name: string
  goal: string | null
  weeks: number
  /** Local calendar day "YYYY-MM-DD"; only used to show "week 3 of 10" */
  startDate: string | null
  createdAt: number
  /** Changes on every write to the program, its sessions or their steps (the backup key uses it) */
  updatedAt: number
}

export interface ProgramSummary extends TrainingProgram {
  sessionCount: number
}

export interface ProgramSession {
  id: string
  programId: string
  /** 1..program weeks */
  week: number
  /** Order within the week; only the order matters, gaps are fine */
  position: number
  type: SessionType
  title: string
  notes: string | null
}

export interface SessionStep {
  id: string
  sessionId: string
  /** Order within the session */
  position: number
  kind: StepKind
  /** A repeat has no target of its own */
  targetKind: TargetKind
  /** Seconds for a duration, metres for a distance, null for none */
  targetValue: number | null
  /** Pace range in seconds per km: paceMin is the fast end, paceMax the slow end */
  paceMin: number | null
  paceMax: number | null
  /** Repeat only: how many times, and how many of the following steps it covers */
  repetitions: number | null
  span: number | null
}

/** A program with everything in it, as written to and read from a backup */
export interface ProgramBundle {
  program: TrainingProgram
  sessions: ProgramSession[]
  steps: SessionStep[]
}

/** What the user edits; ids and times are set by the store */
export interface ProgramInput {
  name: string
  goal: string | null
  weeks: number
  startDate: string | null
}

export interface SessionInput {
  week: number
  type: SessionType
  title: string
  notes: string | null
}

/** A rule was broken; the message is for the user */
export class TrainingError extends Error {}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Days since 1970-01-01 of a "YYYY-MM-DD" day, or null when it is not a real date */
export function dayNumber(date: string): number | null {
  const m = DATE.exec(date)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const ms = Date.UTC(y, mo - 1, d)
  const back = new Date(ms)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null
  }
  return ms / 86_400_000
}

/** Today as a local "YYYY-MM-DD" */
export function localDate(now: number): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export type ProgramWeek =
  { kind: 'before'; daysToStart: number } | { kind: 'in'; week: number } | { kind: 'after' }

/** Where today falls in a program with a start date; week 1 is the first 7 days from the start */
export function programWeek(startDate: string, weeks: number, today: string): ProgramWeek | null {
  const start = dayNumber(startDate)
  const now = dayNumber(today)
  if (start === null || now === null) return null
  if (now < start) return { kind: 'before', daysToStart: start - now }
  const week = Math.floor((now - start) / 7) + 1
  return week > weeks ? { kind: 'after' } : { kind: 'in', week }
}

const isWholeIn = (n: number, min: number, max: number) =>
  Number.isInteger(n) && n >= min && n <= max

/** The program as it should be stored, or a TrainingError naming the first problem */
export function checkProgram(input: ProgramInput): ProgramInput {
  const name = input.name.trim()
  if (name === '') throw new TrainingError('Give the program a name.')
  if (name.length > MAX_NAME_LENGTH) {
    throw new TrainingError(`Keep the name under ${MAX_NAME_LENGTH} characters.`)
  }
  if (!isWholeIn(input.weeks, 1, MAX_WEEKS)) {
    throw new TrainingError(`A program has 1 to ${MAX_WEEKS} weeks.`)
  }
  if (input.startDate !== null && dayNumber(input.startDate) === null) {
    throw new TrainingError('The start date is not a valid date.')
  }
  const goal = input.goal?.trim() || null
  if (goal !== null && goal.length > MAX_NAME_LENGTH) {
    throw new TrainingError(`Keep the goal under ${MAX_NAME_LENGTH} characters.`)
  }
  return { name, goal, weeks: input.weeks, startDate: input.startDate }
}

/** Refuse to drop weeks that still hold sessions */
export function checkWeeksKeepSessions(weeks: number, sessions: ProgramSession[]) {
  const beyond = sessions.filter((s) => s.week > weeks)
  if (beyond.length === 0) return
  const first = Math.min(...beyond.map((s) => s.week))
  const n = beyond.length
  throw new TrainingError(
    `Week ${first} and later still have ${n} ${n === 1 ? 'session' : 'sessions'}. ` +
      'Move or delete them first.',
  )
}

/** The session as it should be stored, or a TrainingError naming the first problem */
export function checkSession(input: SessionInput, weeks: number): SessionInput {
  if (!isWholeIn(input.week, 1, weeks)) {
    throw new TrainingError(`Pick a week from 1 to ${weeks}.`)
  }
  if (!SESSION_TYPES.includes(input.type)) throw new TrainingError('Pick a session type.')
  const title = input.title.trim() || (input.type === 'rest' ? 'Rest' : '')
  if (title === '') throw new TrainingError('Give the session a title.')
  if (title.length > MAX_NAME_LENGTH) {
    throw new TrainingError(`Keep the title under ${MAX_NAME_LENGTH} characters.`)
  }
  const notes = input.notes?.trim() || null
  if (notes !== null && notes.length > MAX_NOTES_LENGTH) {
    throw new TrainingError(`Keep the notes under ${MAX_NOTES_LENGTH} characters.`)
  }
  return { week: input.week, type: input.type, title, notes }
}

const positive = (v: number | null): v is number => v !== null && Number.isFinite(v) && v > 0

/**
 * Check a session's steps, in order. A repeat covers the `span` steps after it, `repetitions`
 * times; repeats do not nest. The step editor comes in PR 2; the rules live here so storage and
 * backup already hold only valid steps.
 */
export function checkSteps(steps: SessionStep[]) {
  let repeatEndsAt = -1
  steps.forEach((step, i) => {
    const n = i + 1
    if (!STEP_KINDS.includes(step.kind)) throw new TrainingError(`Step ${n} has no valid kind.`)
    if (step.kind === 'repeat') {
      if (i <= repeatEndsAt) throw new TrainingError("A repeat can't contain another repeat.")
      if (step.repetitions === null || !isWholeIn(step.repetitions, 1, 99)) {
        throw new TrainingError(`Step ${n}: repeat 1 to 99 times.`)
      }
      if (step.span === null || !Number.isInteger(step.span) || step.span < 1) {
        throw new TrainingError(`Step ${n}: a repeat covers at least 1 step.`)
      }
      const following = steps.length - n
      if (step.span > following) {
        throw new TrainingError(
          `Step ${n}: only ${following} ${following === 1 ? 'step follows' : 'steps follow'} this repeat.`,
        )
      }
      if (step.targetKind !== 'none') {
        throw new TrainingError(`Step ${n}: a repeat has no target of its own.`)
      }
      repeatEndsAt = i + step.span
    } else if (step.repetitions !== null || step.span !== null) {
      throw new TrainingError(`Step ${n}: only a repeat has repetitions.`)
    }
    if (!TARGET_KINDS.includes(step.targetKind)) {
      throw new TrainingError(`Step ${n} has no valid target.`)
    }
    if (step.targetKind === 'none' ? step.targetValue !== null : !positive(step.targetValue)) {
      throw new TrainingError(`Step ${n}: the target needs a value above 0.`)
    }
    const pace = [step.paceMin, step.paceMax]
    if (pace.some((p) => p !== null && !positive(p))) {
      throw new TrainingError(`Step ${n}: the pace is not valid.`)
    }
    if (step.paceMin !== null && step.paceMax !== null && step.paceMin > step.paceMax) {
      throw new TrainingError(`Step ${n}: the faster pace comes first.`)
    }
  })
}
