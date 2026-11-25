import { describe, expect, it } from 'vitest'
import type { RunStep } from '../stepProgress'
import {
  PACE_PHRASES,
  addSample,
  nextPaceCue,
  paceTarget,
  windowSpeed,
  type PaceCoachState,
  type PaceFloors,
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

/** The run floor most tests use, and no walk floor */
const NO_WALK: PaceFloors = { run: 540, walk: null }

/** A stretch of the run: this many seconds at this pace (s/km); null stands still */
type Leg = [seconds: number, pace: number | null]

/**
 * Feed the coach one tick a second through the legs, like the run timer does, and list what it
 * says and when. `speakingAt` marks seconds where other speech is playing.
 */
function drive(
  legs: Leg[],
  opts: { step?: RunStep; floors?: Partial<PaceFloors>; speakingAt?: (s: number) => boolean } = {},
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
        { ...NO_WALK, ...opts.floors },
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
    expect(paceTarget(runStep(), NO_WALK)).toEqual({ fast: 330, slow: 360 })
    expect(paceTarget(runStep({ paceMin: 330, paceMax: null }), NO_WALK)).toEqual({
      fast: 330,
      slow: 330,
    })
  })

  it('gives a run step without a pace only a slow end: the slowest run pace', () => {
    expect(paceTarget(runStep({ paceMin: null, paceMax: null }), { run: 600, walk: null })).toEqual(
      {
        fast: null,
        slow: 600,
      },
    )
  })

  it('never coaches warm-up, recovery or cool-down, even with a pace', () => {
    for (const kind of ['warmup', 'recovery', 'cooldown'] as const) {
      expect(paceTarget(runStep({ kind }), { run: 540, walk: 600 })).toBeNull()
    }
  })

  it('gives a walk step without a pace the walk floor, or nothing when there is none (#153)', () => {
    const walk = runStep({ kind: 'walk', paceMin: null, paceMax: null })
    expect(paceTarget(walk, { run: 540, walk: 630 })).toEqual({ fast: null, slow: 630 })
    expect(paceTarget(walk, NO_WALK)).toBeNull()
  })

  it('gives a walk step with its own pace that range, not the floor (#153)', () => {
    const walk = runStep({ kind: 'walk', paceMin: 540, paceMax: 600 })
    expect(paceTarget(walk, { run: 540, walk: 630 })).toEqual({ fast: 540, slow: 600 })
    expect(paceTarget(walk, NO_WALK)).toEqual({ fast: 540, slow: 600 })
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
    for (let s = 0; s <= 60; s++)
      samples = addSample(
        samples,
        { elapsedMs: s * 1000, distanceM: s < 30 ? s : 30 + (s - 30) * 3 },
        25,
      )
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

  it('says "Faster" once the smoothed pace stays slow for 10 s, after the window has filled', () => {
    // Slow from the start: the window is full at 15 s, then 10 s off
    expect(drive([[50, 420]])).toEqual([[25, 'faster']])
  })

  it('says "Slower" when too fast', () => {
    expect(drive([[50, 300]])).toEqual([[25, 'slower']])
  })

  it('repeats the correction every 60 s while still off', () => {
    expect(drive([[170, 420]])).toEqual([
      [25, 'faster'],
      [85, 'faster'],
      [145, 'faster'],
    ])
  })

  it('says "Back on pace" once after 6 s back in range, only after a correction', () => {
    const said = drive([
      [50, 420],
      [80, 345],
    ])
    expect(said.map(([, key]) => key)).toEqual(['faster', 'onPace'])
    // Never without a correction first
    expect(drive([[100, 345]])).toEqual([])
  })

  it('says "Back on pace" after a short stretch back in range', () => {
    // As on the phone (PR #141): the windowed pace dips into range for a few seconds between GPS
    // swings. 13 s at 5:45 holds the smoothed pace in range long enough for 6 s, not for 10 s
    const said = drive([
      [50, 420],
      [13, 345],
      [30, 420],
    ])
    expect(said).toEqual([
      [25, 'faster'],
      [66, 'onPace'],
      [85, 'faster'],
    ])
  })

  it('keeps two different corrections at least 60 s apart', () => {
    const said = drive([
      [30, 420], // faster at 25
      [60, 280], // too fast now
    ])
    expect(said[0]).toEqual([25, 'faster'])
    const slower = said.find(([, key]) => key === 'slower')
    expect(slower![0]).toBeGreaterThanOrEqual(85)
  })

  it('goes quiet as soon as you stop, even while the smoothed pace still reads as moving', () => {
    // Stopped 5 s before the line is due at 25 s: the 15 s average still reads as moving,
    // the last 6 s do not
    expect(
      drive([
        [20, 420],
        [30, null],
      ]),
    ).toEqual([])
  })

  it('stays quiet while standing still, and the wait starts over afterwards', () => {
    // Slow for 20 s (only 5 s off after the window), a minute at a crossing, then 15 s slow:
    // the wait started over, so it is not yet 10 s off again
    const said = drive([
      [20, 420],
      [60, null],
      [15, 420],
    ])
    expect(said).toEqual([])
  })

  it('holds a due line while other speech plays, then says it', () => {
    const said = drive([[60, 420]], { speakingAt: (s) => s >= 20 && s < 30 })
    expect(said).toEqual([[30, 'faster']])
  })

  it('stays quiet in the last 10 s of a timed step, where the step warning goes', () => {
    // Quiet from 20 s on, so the line due at 25 s is never said
    const step = runStep({ targetKind: 'duration', targetValue: 30 })
    expect(drive([[30, 420]], { step })).toEqual([])
  })

  it('starts over on a new step, so the previous step pace never counts', () => {
    let state: PaceCoachState | null = null
    const walk = runStep({ position: 0, kind: 'walk', paceMin: null, paceMax: null })
    for (let s = 1; s <= 60; s++) {
      state = nextPaceCue(
        state,
        walk,
        { elapsedMs: s * 1000, distanceM: s * 1.4 },
        NO_WALK,
        false,
      ).state
    }
    const run = runStep({ position: 1, startedElapsedMs: 60_000, startedDistanceM: 84 })
    const said: number[] = []
    let d = 84
    for (let s = 61; s <= 120; s++) {
      d += 1000 / 345
      const r = nextPaceCue(state, run, { elapsedMs: s * 1000, distanceM: d }, NO_WALK, false)
      state = r.state
      if (r.cue) said.push(s)
    }
    expect(said).toEqual([])
  })

  it('on a run step without a pace, only says "Faster" when slower than the slowest run pace', () => {
    const step = runStep({ paceMin: null, paceMax: null })
    expect(drive([[100, 300]], { step })).toEqual([]) // fast is fine
    expect(drive([[100, 500]], { step })).toEqual([]) // 8:20, under 9:00
    expect(drive([[50, 660]], { step })).toEqual([[25, 'faster']]) // 11:00, walking
    expect(drive([[50, 660]], { step, floors: { run: 720 } })).toEqual([])
  })

  describe('walk steps (#153)', () => {
    const walk = runStep({ kind: 'walk', paceMin: null, paceMax: null })
    const floors = { walk: 630 } // 10:30

    it('says "Walk faster" when a walk without a pace slows below the walk floor', () => {
      expect(drive([[100, 570]], { step: walk, floors })).toEqual([]) // brisk 9:30
      expect(drive([[100, 400]], { step: walk, floors })).toEqual([]) // no fast end
      expect(drive([[170, 720]], { step: walk, floors })).toEqual([
        [25, 'walkFaster'],
        [85, 'walkFaster'],
        [145, 'walkFaster'],
      ])
      const said = drive(
        [
          [50, 720],
          [80, 570],
        ],
        { step: walk, floors },
      )
      expect(said.map(([, key]) => key)).toEqual(['walkFaster', 'onPace'])
    })

    it('stays quiet on a stop during a walk', () => {
      expect(
        drive(
          [
            [20, 720],
            [60, null],
            [15, 720],
          ],
          { step: walk, floors },
        ),
      ).toEqual([])
    })

    it('says nothing on a walk without a pace when there is no walk floor', () => {
      expect(drive([[100, 900]], { step: walk })).toEqual([])
    })

    it('coaches a walk with its own pace against that range, and can say "Walk slower"', () => {
      const ranged = runStep({ kind: 'walk', paceMin: 540, paceMax: 600 }) // 9:00-10:00
      expect(drive([[50, 480]], { step: ranged, floors })).toEqual([[25, 'walkSlower']])
      // 10:20 is under the 10:30 floor, but over the step's own 10:00 slow end
      expect(drive([[50, 620]], { step: ranged, floors })).toEqual([[25, 'walkFaster']])
      expect(drive([[50, 480]], { step: ranged })).toEqual([[25, 'walkSlower']])
    })

    /**
     * One tick a second over `seconds`: the GPS speed reading is `reading` (m/s, null: none),
     * while distance only counts in 5 m jumps, as on the phone. `jumpEvery` sets how often a
     * jump lands, so distance alone can read slower than the reading
     */
    function walkWithReadings(
      legs: [seconds: number, reading: number | null, jumpEvery: number][],
      step: RunStep = walk,
      floor = 755,
    ) {
      let state: PaceCoachState | null = null
      let t = 0
      let d = 0
      const said: [number, PacePhrase, string][] = []
      for (const [seconds, reading, jumpEvery] of legs) {
        for (let i = 0; i < seconds; i++) {
          t += 1
          if (jumpEvery > 0 && t % jumpEvery === 0) d += 5
          const input = {
            elapsedMs: t * 1000,
            distanceM: d,
            ...(reading !== null && { speedMps: reading }),
          }
          const r = nextPaceCue(state, step, input, { run: 540, walk: floor }, false)
          state = r.state
          if (r.cue) said.push([t, r.cue.key, r.cue.source])
        }
      }
      return said
    }

    it('judges a walk by the GPS speed reading, not by 5 m distance jumps', () => {
      // On the phone (PR #187): a steady 1.35 m/s (12:21) against a 12:35 floor. A 5 m jump
      // every 4 s reads as 16:40 from distance alone, which said "Faster" again and again
      expect(walkWithReadings([[120, 1.35, 4]])).toEqual([])
      expect(walkWithReadings([[120, null, 4]])).toEqual([
        [26, 'walkFaster', 'distance'],
        [86, 'walkFaster', 'distance'],
      ])
    })

    it('says "Walk faster" when the reading slows to a stroll, and "Back on pace" after', () => {
      const said = walkWithReadings([
        [30, 1.35, 4],
        [30, 1.1, 5], // 15:09
        [30, 1.35, 4],
      ])
      expect(said.map(([, key, by]) => [key, by])).toEqual([
        ['walkFaster', 'gps'],
        ['onPace', 'gps'],
      ])
    })

    it('stays quiet while slowing down to a stop', () => {
      // Slowing for a crossing: the 15 s mean drops under 1 m/s before the stop is held
      expect(
        walkWithReadings([
          [30, 1.35, 4],
          [4, 0.9, 6],
          [4, 0.5, 0],
          [10, 0, 0],
          [30, 1.35, 4],
        ]),
      ).toEqual([])
    })

    it('falls back to distance when the readings stop coming', () => {
      expect(
        walkWithReadings([
          [30, 1.35, 4],
          [60, null, 5],
        ]).map(([, key, by]) => [key, by]),
      ).toEqual([['walkFaster', 'distance']])
    })

    it('keeps judging run steps by distance', () => {
      const run = runStep({ paceMin: null, paceMax: null })
      // A reading of 3 m/s (5:33) is ignored: 5 m every 2 s is 6:40, slower than the 6:00 floor
      expect(walkWithReadings([[60, 3, 2]], run, 755).map(([, k]) => k)).toEqual([])
      let state: PaceCoachState | null = null
      let said: string | null = null
      for (let t = 1; t <= 60; t++) {
        const input = { elapsedMs: t * 1000, distanceM: Math.floor(t / 2) * 5, speedMps: 3 }
        const r = nextPaceCue(state, run, input, { run: 360, walk: null }, false)
        state = r.state
        if (r.cue && !said) said = `${r.cue.key} ${r.cue.source}`
      }
      expect(said).toBe('faster distance')
    })
  })

  it('coaches a 1-minute run step at a slow jog, where distance grows in 5 m steps', () => {
    // As on the phone (PR #141): a fix only counts once 5 m from the last one, so at about
    // 13:20 /km the distance jumps 5.3 m every 3 to 6 s. Off the 8:00 floor, and not a stop.
    const step = runStep({ paceMin: null, paceMax: null, targetKind: 'duration', targetValue: 60 })
    const gaps = [3, 4, 6, 4]
    const jumps = new Set<number>()
    for (let s = 0, i = 0; s <= 60; i++) jumps.add((s += gaps[i % gaps.length]!))
    let state: PaceCoachState | null = null
    let d = 0
    const said: number[] = []
    for (let s = 1; s <= 60; s++) {
      if (jumps.has(s)) d += 5.3
      const totals = { elapsedMs: s * 1000, distanceM: d }
      const r = nextPaceCue(state, step, totals, { run: 480, walk: null }, false)
      state = r.state
      if (r.cue) said.push(s)
    }
    expect(said).toHaveLength(1)
    expect(said[0]).toBeLessThan(50) // before the step warning's last 10 s
  })

  it('says "Back on pace" at a steady pace inside the range while distance grows in 5 m steps', () => {
    // As on the phone (PR #141, second test run): a fix only counts once it is 5 m from the last
    // counted one, so the distance jumps about 6 m every 2 to 3 s. Judged up to the timer tick,
    // 15 s holds 5 to 7 jumps and reads as 5:57 to 8:20 at a steady 7:13, flipping out of range
    // every few seconds
    const step = runStep({ paceMin: 420, paceMax: 480 }) // 7:00-8:00
    const gaps = [2, 3, 2, 3, 3] // 6 m every 2.6 s on average: 7:13
    const jumps = new Set<number>()
    for (let s = 40, i = 0; s <= 120; i++) jumps.add((s += gaps[i % gaps.length]!))
    let state: PaceCoachState | null = null
    let d = 0
    const said: [number, PacePhrase][] = []
    for (let s = 1; s <= 120; s++) {
      if (s <= 40)
        d += 1000 / 600 // 10:00 first, for a "Faster"
      else if (jumps.has(s)) d += 6
      const r = nextPaceCue(state, step, { elapsedMs: s * 1000, distanceM: d }, NO_WALK, false)
      state = r.state
      if (r.cue) said.push([s, r.cue.key])
    }
    expect(said.map(([, key]) => key)).toEqual(['faster', 'onPace'])
  })

  it('counts a pace within the margin as back on pace', () => {
    // 6:53 after a "Faster": past the 7:00 fast end, but not by the 10 s margin
    const step = runStep({ paceMin: 420, paceMax: 480 })
    let state: PaceCoachState | null = null
    let d = 0
    const said: PacePhrase[] = []
    for (let s = 1; s <= 120; s++) {
      d += 1000 / (s <= 40 ? 600 : 413)
      const r = nextPaceCue(state, step, { elapsedMs: s * 1000, distanceM: d }, NO_WALK, false)
      state = r.state
      if (r.cue) said.push(r.cue.key)
    }
    expect(said).toEqual(['faster', 'onPace'])
  })

  it('has fixed lines', () => {
    expect(PACE_PHRASES).toEqual({
      faster: 'Faster',
      slower: 'Slower',
      onPace: 'Back on pace',
      walkFaster: 'Walk faster',
      walkSlower: 'Walk slower',
    })
  })
})
