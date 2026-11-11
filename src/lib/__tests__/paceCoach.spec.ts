import { describe, expect, it } from 'vitest'
import type { RunStep } from '../stepProgress'
import {
  PACE_PHRASES,
  addSample,
  nextPaceCue,
  paceTarget,
  windowSpeed,
  type PaceCoachState,
  type PacePhrase,
} from '../paceCoach'

const runStep = (over: Partial<RunStep> = {}): RunStep => ({
  position: 0,
  kind: 'run',
  targetKind: 'none',
  targetValue: null,
  paceMin: 330, // 5:30
  paceMax: 360, // 6:00
  repetition: null,
  repetitions: null,
  startedElapsedMs: 0,
  startedDistanceM: 0,
  endedElapsedMs: null,
  endedDistanceM: null,
  ...over,
})

/** A stretch of the run: this many seconds at this pace (s/km); null stands still */
type Leg = [seconds: number, pace: number | null]

/**
 * Feed the coach one tick a second through the legs, like the run timer does, and list what it
 * says and when. `speakingAt` marks seconds where other speech is playing.
 */
function drive(
  legs: Leg[],
  opts: { step?: RunStep; slowest?: number; speakingAt?: (s: number) => boolean } = {},
) {
  const step = opts.step ?? runStep()
  let state: PaceCoachState | null = null
  let t = 0
  let d = 0
  const said: [number, PacePhrase][] = []
  for (const [seconds, pace] of legs) {
    for (let i = 0; i < seconds; i++) {
      t += 1
      if (pace !== null) d += 1000 / pace
      const result = nextPaceCue(
        state,
        step,
        { elapsedMs: t * 1000, distanceM: d },
        opts.slowest ?? 540,
        opts.speakingAt?.(t) ?? false,
      )
      state = result.state
      if (result.cue) said.push([t, result.cue.key])
    }
  }
  return said
}

describe('paceTarget', () => {
  it('uses the step range, a single pace as both ends', () => {
    expect(paceTarget(runStep(), 540)).toEqual({ fast: 330, slow: 360 })
    expect(paceTarget(runStep({ paceMin: 330, paceMax: null }), 540)).toEqual({ fast: 330, slow: 330 })
  })

  it('gives a run step without a pace only a slow end: the slowest run pace', () => {
    expect(paceTarget(runStep({ paceMin: null, paceMax: null }), 600)).toEqual({ fast: null, slow: 600 })
  })

  it('never coaches warm-up, walk, recovery or cool-down, even with a pace', () => {
    for (const kind of ['warmup', 'walk', 'recovery', 'cooldown'] as const) {
      expect(paceTarget(runStep({ kind }), 540)).toBeNull()
    }
  })
})

describe('smoothing', () => {
  it('needs a full window before it gives a speed', () => {
    let samples = addSample([], { elapsedMs: 0, distanceM: 0 }, 25)
    samples = addSample(samples, { elapsedMs: 24_000, distanceM: 72 }, 25)
    expect(windowSpeed(samples, 25)).toBeNull()
    samples = addSample(samples, { elapsedMs: 25_000, distanceM: 75 }, 25)
    expect(windowSpeed(samples, 25)).toBe(3)
  })

  it('averages over the last 25 s only', () => {
    let samples: ReturnType<typeof addSample> = []
    for (let s = 0; s <= 60; s++) samples = addSample(samples, { elapsedMs: s * 1000, distanceM: s < 30 ? s : 30 + (s - 30) * 3 }, 25)
    expect(windowSpeed(samples, 25)).toBe(3)
  })

  it('restarts the window on a distance jump after a GPS gap', () => {
    let samples = addSample([], { elapsedMs: 0, distanceM: 0 }, 25)
    samples = addSample(samples, { elapsedMs: 30_000, distanceM: 90 }, 25)
    samples = addSample(samples, { elapsedMs: 31_000, distanceM: 290 }, 25)
    expect(samples).toEqual([{ elapsedMs: 31_000, distanceM: 290 }])
  })
})

describe('nextPaceCue', () => {
  it('says nothing on pace or within the margin', () => {
    expect(drive([[300, 345]])).toEqual([])
    expect(drive([[300, 368]])).toEqual([]) // 6:08, inside the 10 s margin
  })

  it('says "Faster" once the smoothed pace stays slow for 20 s, after the window has filled', () => {
    // Slow from the start: the window is full at 25 s, then 20 s off
    expect(drive([[50, 420]])).toEqual([[45, 'faster']])
  })

  it('says "Slower" when too fast', () => {
    expect(drive([[50, 300]])).toEqual([[45, 'slower']])
  })

  it('repeats the correction every 60 s while still off', () => {
    expect(drive([[170, 420]])).toEqual([
      [45, 'faster'],
      [105, 'faster'],
      [165, 'faster'],
    ])
  })

  it('says "Back on pace" once after 10 s back in range, only after a correction', () => {
    const said = drive([
      [50, 420],
      [80, 345],
    ])
    expect(said.map(([, key]) => key)).toEqual(['faster', 'onPace'])
    // Never without a correction first
    expect(drive([[100, 345]])).toEqual([])
  })

  it('keeps two different corrections at least 60 s apart', () => {
    const said = drive([
      [50, 420], // faster at 45
      [60, 280], // too fast now
    ])
    expect(said[0]).toEqual([45, 'faster'])
    const slower = said.find(([, key]) => key === 'slower')
    expect(slower![0]).toBeGreaterThanOrEqual(105)
  })

  it('goes quiet as soon as you stop, even while the smoothed pace still reads as moving', () => {
    // At 45 s the 25 s average is still well above walking speed, but the last 5 s are not
    expect(drive([[41, 420], [30, null]])).toEqual([])
  })

  it('stays quiet while standing still, and the wait starts over afterwards', () => {
    // Slow for 40 s (not yet 20 s off after the window), then a minute at a crossing
    const said = drive([
      [40, 420],
      [60, null],
      [30, 420],
    ])
    expect(said).toEqual([])
  })

  it('holds a due line while other speech plays, then says it', () => {
    const said = drive([[60, 420]], { speakingAt: (s) => s >= 40 && s < 50 })
    expect(said).toEqual([[50, 'faster']])
  })

  it('stays quiet in the last 10 s of a timed step, where the step warning goes', () => {
    const step = runStep({ targetKind: 'duration', targetValue: 50 })
    expect(drive([[50, 420]], { step })).toEqual([])
  })

  it('starts over on a new step, so the previous step pace never counts', () => {
    let state: PaceCoachState | null = null
    const walk = runStep({ position: 0, kind: 'walk' })
    for (let s = 1; s <= 60; s++) {
      state = nextPaceCue(state, walk, { elapsedMs: s * 1000, distanceM: s * 1.4 }, 540, false).state
    }
    const run = runStep({ position: 1, startedElapsedMs: 60_000, startedDistanceM: 84 })
    const said: number[] = []
    let d = 84
    for (let s = 61; s <= 120; s++) {
      d += 1000 / 345
      const r = nextPaceCue(state, run, { elapsedMs: s * 1000, distanceM: d }, 540, false)
      state = r.state
      if (r.cue) said.push(s)
    }
    expect(said).toEqual([])
  })

  it('on a run step without a pace, only says "Faster" when slower than the slowest run pace', () => {
    const step = runStep({ paceMin: null, paceMax: null })
    expect(drive([[100, 300]], { step })).toEqual([]) // fast is fine
    expect(drive([[100, 500]], { step })).toEqual([]) // 8:20, under 9:00
    expect(drive([[50, 660]], { step })).toEqual([[45, 'faster']]) // 11:00, walking
    expect(drive([[50, 660]], { step, slowest: 720 })).toEqual([])
  })

  it('has fixed lines', () => {
    expect(PACE_PHRASES).toEqual({ faster: 'Faster', slower: 'Slower', onPace: 'Back on pace' })
  })
})
