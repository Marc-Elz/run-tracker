import { describe, expect, it } from 'vitest'
import {
  checkProgram,
  checkSession,
  checkSteps,
  checkWeeksKeepSessions,
  dayNumber,
  addStep,
  findStep,
  formatMinSec,
  fromBlocks,
  isRunnable,
  localDate,
  moveStep,
  nextSession,
  parseMinSec,
  programWeek,
  removeStep,
  replaceStep,
  stepSummary,
  toBlocks,
  TrainingError,
  type ProgramSession,
  type SessionStep,
  type StepBlock,
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

describe('step blocks', () => {
  // warm-up, 6× (run, walk), cool-down, with gaps in the imported positions
  const stored = [
    step({ id: 'w', kind: 'warmup', position: 0 }),
    step({ id: 'r', kind: 'repeat', position: 3, repetitions: 6, span: 2 }),
    step({ id: 'run', position: 4, targetKind: 'duration', targetValue: 60 }),
    step({ id: 'walk', kind: 'walk', position: 7, targetKind: 'duration', targetValue: 120 }),
    step({ id: 'c', kind: 'cooldown', position: 9 }),
  ]
  const ids = (blocks: StepBlock[]) =>
    blocks.map((b) => (b.children.length ? [b.step.id, b.children.map((c) => c.id)] : b.step.id))

  it('groups a repeat with the steps it covers, and flattens back keeping ids', () => {
    const blocks = toBlocks(stored)
    expect(ids(blocks)).toEqual(['w', ['r', ['run', 'walk']], 'c'])
    const flat = fromBlocks('s', blocks)
    expect(flat.map((s) => s.id)).toEqual(['w', 'r', 'run', 'walk', 'c'])
    expect(flat.map((s) => s.position)).toEqual([0, 1, 2, 3, 4])
    expect(flat).toEqual(stored.map((s, position) => ({ ...s, position })))
    expect(() => checkSteps(flat)).not.toThrow()
  })

  it('counts the span from the steps and gives a repeat no target', () => {
    const blocks = toBlocks(stored)
    blocks[1] = {
      step: { ...blocks[1]!.step, span: 9, targetKind: 'duration', targetValue: 5, paceMin: 300 },
      children: [...blocks[1]!.children, step({ id: 'extra' })],
    }
    const flat = fromBlocks('other', blocks)
    expect(flat[1]).toMatchObject({
      span: 3,
      targetKind: 'none',
      targetValue: null,
      paceMin: null,
      sessionId: 'other',
    })
    expect(() => checkSteps(flat)).not.toThrow()
  })

  it('moves a step within a list, into a repeat and out of it', () => {
    const blocks = toBlocks(stored)
    expect(ids(moveStep(blocks, { list: null, index: 2 }, { list: null, index: 0 })!)).toEqual([
      'c',
      'w',
      ['r', ['run', 'walk']],
    ])
    expect(ids(moveStep(blocks, { list: 'r', index: 1 }, { list: 'r', index: 0 })!)).toEqual([
      'w',
      ['r', ['walk', 'run']],
      'c',
    ])
    // The warm-up into the repeat: the repeat is at index 0 once the warm-up left
    expect(ids(moveStep(blocks, { list: null, index: 0 }, { list: 'r', index: 2 })!)).toEqual([
      ['r', ['run', 'walk', 'w']],
      'c',
    ])
    expect(ids(moveStep(blocks, { list: 'r', index: 0 }, { list: null, index: 3 })!)).toEqual([
      'w',
      ['r', ['walk']],
      'c',
      'run',
    ])
    expect(ids(blocks)).toEqual(['w', ['r', ['run', 'walk']], 'c'])
    for (const moved of [
      moveStep(blocks, { list: null, index: 0 }, { list: 'r', index: 2 })!,
      moveStep(blocks, { list: 'r', index: 0 }, { list: null, index: 3 })!,
    ]) {
      expect(() => checkSteps(fromBlocks('s', moved))).not.toThrow()
    }
  })

  it('refuses a repeat inside a repeat, and the last step out of a repeat', () => {
    const two = [
      ...toBlocks(stored),
      {
        step: step({ id: 'r2', kind: 'repeat', repetitions: 2 }),
        children: [step({ id: 'only' })],
      },
    ]
    expect(moveStep(two, { list: null, index: 3 }, { list: 'r', index: 0 })).toBeNull()
    expect(moveStep(two, { list: 'r2', index: 0 }, { list: null, index: 0 })).toBeNull()
    expect(moveStep(two, { list: 'r2', index: 0 }, { list: 'r', index: 0 })).toBeNull()
    expect(moveStep(two, { list: 'r2', index: 0 }, { list: 'r2', index: 0 })).not.toBeNull()
    expect(moveStep(two, { list: null, index: 9 }, { list: null, index: 0 })).toBeNull()
    expect(moveStep(two, { list: 'nope', index: 0 }, { list: null, index: 0 })).toBeNull()
  })

  it('adds, replaces, finds and removes steps; a repeat goes with its steps and when emptied', () => {
    let blocks = toBlocks(stored)
    blocks = addStep(blocks, step({ id: 'n' }), 'r')
    blocks = addStep(blocks, step({ id: 't' }), null)
    expect(ids(blocks)).toEqual(['w', ['r', ['run', 'walk', 'n']], 'c', 't'])
    blocks = replaceStep(blocks, step({ id: 'n', kind: 'walk' }))
    expect(findStep(blocks, 'n')).toMatchObject({
      step: { kind: 'walk' },
      parent: { step: { id: 'r' } },
    })
    expect(findStep(blocks, 'r')?.children).toHaveLength(3)
    expect(findStep(blocks, 'gone')).toBeNull()
    expect(ids(removeStep(blocks, 'r'))).toEqual(['w', 'c', 't'])
    const single = toBlocks([
      step({ id: 'r', kind: 'repeat', repetitions: 2, span: 1 }),
      step({ id: 'a' }),
    ])
    expect(removeStep(single, 'a')).toEqual([])
  })
})

describe('min:s and step summaries', () => {
  it('reads min:s or whole minutes, and refuses anything else', () => {
    expect(parseMinSec('4:50')).toBe(290)
    expect(parseMinSec(' 12 ')).toBe(720)
    expect(parseMinSec('90:00')).toBe(5400)
    for (const bad of ['', '0', '0:00', '4:5', '4:60', '-1', 'abc', '1:2:3']) {
      expect(parseMinSec(bad)).toBeNull()
    }
    expect(formatMinSec(120)).toBe('2:00')
    expect(formatMinSec(3900)).toBe('1:05:00')
  })

  it('sums a step up in one line', () => {
    expect(stepSummary(step({ kind: 'walk', targetKind: 'duration', targetValue: 120 }))).toBe(
      'Walk 2:00',
    )
    expect(
      stepSummary(step({ targetKind: 'distance', targetValue: 400, paceMin: 290, paceMax: 300 })),
    ).toBe('Run 400 m · 4:50–5:00 /km')
    expect(stepSummary(step({ kind: 'cooldown', targetKind: 'distance', targetValue: 1500 }))).toBe(
      'Cool-down 1.5 km',
    )
    expect(stepSummary(step({ paceMax: 330 }))).toBe('Run · 5:30 /km')
    expect(stepSummary(step({ kind: 'repeat', repetitions: 6 }), 2)).toBe('6× · 2 steps')
  })
})

describe('next session (#40)', () => {
  const session = (id: string, week: number, position: number, type = 'easy'): ProgramSession =>
    ({ id, programId: 'p', week, position, type, title: id, notes: null }) as ProgramSession
  // Stored order is not guaranteed: week 2 first on purpose
  const sessions = [
    session('w2a', 2, 0),
    session('w1b', 1, 5),
    session('w1rest', 1, 1, 'rest'),
    session('w1a', 1, 0),
  ]

  it('is the first session by week, then position, that has no finished run', () => {
    expect(nextSession(sessions, new Set())?.id).toBe('w1a')
    expect(nextSession(sessions, new Set(['w1a']))?.id).toBe('w1b')
  })

  it('passes over skipped sessions, and a skipped one is not next even when it is the only one left (#102)', () => {
    expect(nextSession(sessions, new Set(), new Set(['w1a']))?.id).toBe('w1b')
    expect(nextSession(sessions, new Set(['w1a']), new Set(['w1b', 'w2a']))).toBeNull()
  })

  it('skips rest days', () => {
    expect(nextSession(sessions, new Set(['w1a', 'w1b']))?.id).toBe('w2a')
    expect(isRunnable(sessions[2]!, new Set())).toBe(false)
  })

  it('keeps a missed session next until it is run', () => {
    expect(nextSession(sessions, new Set(['w1b', 'w2a']))?.id).toBe('w1a')
  })

  it('is null when every session is done or a rest day, or there are none', () => {
    expect(nextSession(sessions, new Set(['w1a', 'w1b', 'w2a']))).toBeNull()
    expect(nextSession([], new Set())).toBeNull()
  })
})
