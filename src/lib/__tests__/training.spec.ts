import { describe, expect, it } from 'vitest'
import {
  checkProgram,
  checkSession,
  checkSteps,
  checkWeeksKeepSessions,
  dayNumber,
  localDate,
  programWeek,
  TrainingError,
  type ProgramSession,
  type SessionStep,
} from '../training'

const step = (over: Partial<SessionStep> = {}): SessionStep => ({
  id: 'x',
  sessionId: 's',
  position: 0,
  kind: 'run',
  targetKind: 'none',
  targetValue: null,
  paceMin: null,
  paceMax: null,
  repetitions: null,
  span: null,
  ...over,
})
const repeat = (repetitions: number, span: number) => step({ kind: 'repeat', repetitions, span })

describe('checkProgram', () => {
  const ok = { name: ' Half marathon ', goal: '  ', weeks: 10, startDate: null }

  it('trims the name and turns an empty goal into none', () => {
    expect(checkProgram(ok)).toEqual({
      name: 'Half marathon',
      goal: null,
      weeks: 10,
      startDate: null,
    })
  })

  it('refuses a missing name, a week count out of range and a date that does not exist', () => {
    expect(() => checkProgram({ ...ok, name: ' ' })).toThrow(TrainingError)
    expect(() => checkProgram({ ...ok, weeks: 0 })).toThrow(/1 to 52 weeks/)
    expect(() => checkProgram({ ...ok, weeks: 2.5 })).toThrow(/1 to 52 weeks/)
    expect(() => checkProgram({ ...ok, startDate: '2027-02-30' })).toThrow(/not a valid date/)
    expect(checkProgram({ ...ok, startDate: '2027-02-28' }).startDate).toBe('2027-02-28')
  })
})

describe('checkWeeksKeepSessions', () => {
  const at = (week: number) => ({ week }) as ProgramSession

  it('allows dropping empty weeks only, naming how many sessions are in the way', () => {
    expect(() => checkWeeksKeepSessions(8, [at(1), at(8)])).not.toThrow()
    expect(() => checkWeeksKeepSessions(8, [at(1), at(9), at(10), at(10)])).toThrow(
      'Week 9 and later still have 3 sessions. Move or delete them first.',
    )
  })
})

describe('checkSession', () => {
  it('needs a week inside the program and a title, except that a rest day is called Rest', () => {
    const input = { week: 3, type: 'easy' as const, title: ' 30 min ', notes: '' }
    expect(checkSession(input, 4)).toEqual({ week: 3, type: 'easy', title: '30 min', notes: null })
    expect(() => checkSession({ ...input, week: 5 }, 4)).toThrow(/week from 1 to 4/)
    expect(() => checkSession({ ...input, title: '' }, 4)).toThrow(/title/)
    expect(checkSession({ ...input, type: 'rest', title: '' }, 4).title).toBe('Rest')
  })
})

describe('checkSteps', () => {
  it('accepts warm-up, a repeat over the next two steps, and cool-down', () => {
    expect(() =>
      checkSteps([
        step({ kind: 'warmup', targetKind: 'duration', targetValue: 600 }),
        repeat(6, 2),
        step({ targetKind: 'distance', targetValue: 400, paceMin: 290, paceMax: 300 }),
        step({ kind: 'recovery', targetKind: 'duration', targetValue: 90 }),
        step({ kind: 'cooldown' }),
      ]),
    ).not.toThrow()
  })

  it('refuses a repeat that reaches past the end, nests, or has a target', () => {
    expect(() => checkSteps([repeat(3, 2), step()])).toThrow(
      'Step 1: only 1 step follows this repeat.',
    )
    expect(() => checkSteps([repeat(3, 2), repeat(2, 1), step()])).toThrow(/can't contain another/)
    expect(() => checkSteps([repeat(0, 1), step()])).toThrow(/1 to 99 times/)
    expect(() =>
      checkSteps([{ ...repeat(2, 1), targetKind: 'duration', targetValue: 60 }, step()]),
    ).toThrow(/no target of its own/)
  })

  it('refuses a target without a value, repetitions outside a repeat, and a pace range the wrong way round', () => {
    expect(() => checkSteps([step({ targetKind: 'distance', targetValue: null })])).toThrow(
      /above 0/,
    )
    expect(() => checkSteps([step({ targetValue: 5 })])).toThrow(/above 0/)
    expect(() => checkSteps([step({ repetitions: 2 })])).toThrow(/only a repeat/)
    expect(() => checkSteps([step({ paceMin: 300, paceMax: 290 })])).toThrow(
      /faster pace comes first/,
    )
  })
})

describe('dates', () => {
  it('reads calendar days and refuses ones that do not exist', () => {
    expect(dayNumber('1970-01-02')).toBe(1)
    expect(dayNumber('2028-02-29')).not.toBeNull()
    expect(dayNumber('2027-02-29')).toBeNull()
    expect(dayNumber('5 Jan')).toBeNull()
  })

  it('gives the local date', () => {
    expect(localDate(new Date(2027, 0, 4, 23, 59).getTime())).toBe('2027-01-04')
  })

  it('places today in the program: before the start, in week N, or after the last week', () => {
    expect(programWeek('2027-01-04', 2, '2027-01-01')).toEqual({ kind: 'before', daysToStart: 3 })
    expect(programWeek('2027-01-04', 2, '2027-01-04')).toEqual({ kind: 'in', week: 1 })
    expect(programWeek('2027-01-04', 2, '2027-01-10')).toEqual({ kind: 'in', week: 1 })
    expect(programWeek('2027-01-04', 2, '2027-01-11')).toEqual({ kind: 'in', week: 2 })
    expect(programWeek('2027-01-04', 2, '2027-01-18')).toEqual({ kind: 'after' })
    // Across the switch to summer time a day is still a day
    expect(programWeek('2027-03-22', 2, '2027-03-29')).toEqual({ kind: 'in', week: 2 })
  })
})
