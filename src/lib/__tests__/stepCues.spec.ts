import { describe, expect, it } from 'vitest'
import type { SessionStep } from '../training'
import {
  advanceSteps,
  applyChange,
  expandSteps,
  type RunStep,
  type StepTotals,
  type TimelineStep,
} from '../stepProgress'
import {
  announceText,
  initStepCueState,
  nextStepCue,
  warningDue,
  type StepCueState,
} from '../stepCues'

let ids = 0
const step = (over: Partial<SessionStep> = {}): SessionStep => ({
  id: `s${ids++}`,
  sessionId: 'session',
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
const timed = (kind: SessionStep['kind'], seconds: number, over: Partial<SessionStep> = {}) =>
  step({ kind, targetKind: 'duration', targetValue: seconds, ...over })
const metres = (kind: SessionStep['kind'], m: number) =>
  step({ kind, targetKind: 'distance', targetValue: m })
const repeat = (repetitions: number, span: number) => step({ kind: 'repeat', repetitions, span })
const at = (elapsedMs: number, distanceM = 0): StepTotals => ({ elapsedMs, distanceM })
const withPositions = (steps: SessionStep[]) => steps.map((s, i) => ({ ...s, position: i }))

/** Everything spoken over these ticks, the way the composable drives it */
function spoken(timeline: TimelineStep[], ticks: StepTotals[], from?: RunStep[]): string[] {
  let runSteps = from ?? []
  let state: StepCueState | null = null
  const out: string[] = []
  for (const totals of ticks) {
    const change = advanceSteps(timeline, runSteps, totals)
    if (change) runSteps = applyChange(runSteps, change)
    state ??= initStepCueState(timeline, runSteps, totals)
    const cue = nextStepCue(state, timeline, runSteps, totals)
    if (cue) {
      state = cue.state
      out.push(cue.text)
    }
  }
  return out
}

const sec = (s: number) => at(s * 1000)

describe('announceText', () => {
  const tl = (steps: SessionStep[]) => expandSteps(withPositions(steps))

  it('says the kind and its duration or distance', () => {
    const [a, b, c] = tl([timed('walk', 120), metres('run', 400), metres('run', 1500)])
    expect(announceText(a!, null)).toBe('Walk, 2 minutes')
    expect(announceText(b!, null)).toBe('Run, 400 metres')
    expect(announceText(c!, null)).toBe('Run, 1.5 kilometres')
  })

  it('adds the target pace, as a single value or a range', () => {
    const [one, range] = tl([
      timed('run', 60, { paceMin: 330, paceMax: 330 }),
      timed('run', 60, { paceMin: 300, paceMax: 330 }),
    ])
    expect(announceText(one!, null)).toBe('Run, 1 minute, pace 5 minutes 30 seconds per kilometre')
    expect(announceText(range!, null)).toBe(
      'Run, 1 minute, pace between 5 minutes and 5 minutes 30 seconds per kilometre',
    )
  })

  it('names a step without a target by its kind only', () => {
    expect(announceText(tl([step({ kind: 'cooldown' })])[0]!, null)).toBe('Cool-down')
  })

  it('says "Last one" once, at the start of the final round', () => {
    const timeline = tl([repeat(2, 2), timed('run', 60), timed('walk', 60)])
    expect(timeline.map((s, i) => announceText(s, timeline[i - 1] ?? null))).toEqual([
      'Run, 1 minute',
      'Walk, 1 minute',
      'Last one. Run, 1 minute',
      'Walk, 1 minute',
    ])
  })

  it('does not say "Last one" for a repeat of one', () => {
    const timeline = tl([repeat(1, 1), timed('run', 60)])
    expect(announceText(timeline[0]!, null)).toBe('Run, 1 minute')
  })
})

describe('warningDue', () => {
  const open = (s: SessionStep): RunStep => ({
    ...expandSteps(withPositions([s]))[0]!,
    startedElapsedMs: 0,
    startedDistanceM: 0,
    endedElapsedMs: null,
    endedDistanceM: null,
  })

  it('is due within 10 s of a timed step ending', () => {
    expect(warningDue(open(timed('run', 60)), sec(49))).toBe(false)
    expect(warningDue(open(timed('run', 60)), sec(50))).toBe(true)
  })

  it('is due within 50 m of a distance step ending', () => {
    expect(warningDue(open(metres('run', 400)), at(0, 349))).toBe(false)
    expect(warningDue(open(metres('run', 400)), at(0, 350))).toBe(true)
  })

  it('never warns for short steps or steps without a target', () => {
    expect(warningDue(open(timed('run', 29)), sec(25))).toBe(false)
    expect(warningDue(open(metres('run', 199)), at(0, 190))).toBe(false)
    expect(warningDue(open(step()), sec(500))).toBe(false)
  })
})

describe('nextStepCue', () => {
  const timeline = expandSteps(
    withPositions([timed('warmup', 60), timed('run', 30), timed('walk', 20)]),
  )

  it('announces each step, warns before a change, and ends the session', () => {
    expect(spoken(timeline, [0, 1, 49, 50, 51, 60, 89, 90, 91, 110, 111].map(sec))).toEqual([
      'Warm-up, 1 minute',
      'Run in 10 seconds',
      'Run, 30 seconds',
      'Walk in 10 seconds',
      'Walk, 20 seconds',
      'Session done',
    ])
  })

  it('does not warn during a short step, and says the end only once', () => {
    // The 20 s walk is under 30 s, and it is the last step anyway: no warning in it
    const out = spoken(timeline, [0, 60, 90, 100, 110, 111, 150].map(sec))
    expect(out.filter((t) => t.includes(' in '))).toEqual([])
    expect(out.filter((t) => t === 'Session done')).toHaveLength(1)
  })

  it('speaks only the newest step after a late tick', () => {
    expect(spoken(timeline, [sec(0), sec(95)])).toEqual(['Warm-up, 1 minute', 'Walk, 20 seconds'])
  })

  it('says nothing again when a recovered run starts from its stored steps', () => {
    const first = advanceSteps(timeline, [], sec(0))!
    const stored = applyChange([], first)
    expect(spoken(timeline, [sec(40), sec(41), sec(42)], stored)).toEqual([])
  })

  it('says nothing for a session already done when resumed', () => {
    const all = advanceSteps(timeline, [], sec(500))!
    expect(spoken(timeline, [sec(501)], applyChange([], all))).toEqual([])
  })

  it('stays silent without a timeline', () => {
    const state: StepCueState = { announced: -1, warned: -1, doneSaid: false }
    expect(nextStepCue(state, [], [], sec(5))).toBeNull()
  })

  it('vibrates on a change and the end, not on a warning', () => {
    const state: StepCueState = { announced: -1, warned: -1, doneSaid: false }
    const runSteps = applyChange([], advanceSteps(timeline, [], sec(0))!)
    const announce = nextStepCue(state, timeline, runSteps, sec(0))!
    expect(announce.vibrate).toBe(true)
    const warn = nextStepCue(announce.state, timeline, runSteps, sec(55))!
    expect(warn.text).toBe('Run in 10 seconds')
    expect(warn.vibrate).toBe(false)
  })
})
