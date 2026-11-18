import { describe, expect, it } from 'vitest'
import {
  AUTO_PAUSE_PHRASES,
  initAutoPauseState,
  nextAutoPause,
  type AutoPauseEvent,
  type AutoPauseInput,
  type AutoPauseState,
} from '../autoPause'
import type { TrackPoint } from '../geo'

const M_PER_DEG = 111_320
const LAT = 52

/** A fix `northM` metres north of the start, one per second from t = 0 */
function fix(s: number, northM: number, extra: Partial<TrackPoint> = {}): AutoPauseInput {
  return {
    kind: 'fix',
    at: s * 1000,
    point: { lat: LAT + northM / M_PER_DEG, lon: 4, timestamp: s * 1000, accuracy: 5, ...extra },
  }
}

const motion = (s: number, level: number): AutoPauseInput => ({
  kind: 'motion',
  at: s * 1000,
  level,
})

/** Feed inputs in order; returns the final state and every event with the second it came at */
function feed(inputs: AutoPauseInput[], from: AutoPauseState = initAutoPauseState()) {
  let state = from
  const events: { s: number; event: AutoPauseEvent }[] = []
  for (const input of inputs) {
    const result = nextAutoPause(state, input)
    state = result.state
    if (result.event) events.push({ s: input.at / 1000, event: result.event })
  }
  return { state, events }
}

/** Run north at `mps` from second `from` to `to`, starting at `startM`; GPS speed `doppler` */
function run(from: number, to: number, startM: number, mps: number, doppler?: number) {
  const out: AutoPauseInput[] = []
  for (let s = from; s <= to; s++) {
    out.push(fix(s, startM + (s - from) * mps, doppler === undefined ? {} : { speed: doppler }))
  }
  return out
}

/** Stand at `atM` from second `from` to `to`, GPS speed 0 */
function stand(from: number, to: number, atM: number, accuracy = 5) {
  const out: AutoPauseInput[] = []
  for (let s = from; s <= to; s++) out.push(fix(s, atM, { speed: 0, accuracy }))
  return out
}

/** Offsets in metres (north, east) wandering inside a 25 m box, like the #68 indoor pattern */
const DRIFT = [
  [0, 0],
  [8, -5],
  [12, 3],
  [-6, 11],
  [-12, -12],
  [4, 12],
  [11, -10],
  [-9, 2],
  [2, -12],
  [-12, 8],
]

/** Stand at `atM` while the GPS wanders at 20 m accuracy; `doppler` false leaves speed out */
function drift(from: number, to: number, atM: number, doppler = true) {
  const out: AutoPauseInput[] = []
  for (let s = from; s <= to; s++) {
    const [n, e] = DRIFT[(s - from) % DRIFT.length]!
    const point: TrackPoint = {
      lat: LAT + (atM + n!) / M_PER_DEG,
      lon: 4 + e! / (M_PER_DEG * Math.cos((LAT * Math.PI) / 180)),
      timestamp: s * 1000,
      accuracy: 20,
    }
    if (doppler) point.speed = 0.2
    out.push({ kind: 'fix', at: s * 1000, point })
  }
  return out
}

describe('auto-pause detector', () => {
  it('has stable phrase keys', () => {
    expect(AUTO_PAUSE_PHRASES).toEqual({ stopped: 'Stop detected', resumed: 'Resumed' })
  })

  it('stops after standing for the stop hold', () => {
    const { events } = feed([...run(0, 20, 0, 3, 3), ...stand(21, 30, 60)])
    expect(events).toEqual([{ s: 25, event: { kind: 'stop' } }])
  })

  it('never stops before moving was seen: at the start line', () => {
    const { events } = feed(stand(0, 30, 0))
    expect(events).toEqual([])
  })

  it('does not stop on a slowdown shorter than the hold', () => {
    const { events } = feed([
      ...run(0, 20, 0, 3, 3),
      ...stand(21, 23, 60),
      ...run(24, 40, 60, 3, 3),
    ])
    expect(events).toEqual([])
  })

  it('never stops across a GPS gap', () => {
    // Slow for 2 s, nothing for 10 s (a tunnel), then one slow fix: the hold starts over
    const { events } = feed([...run(0, 20, 0, 3, 3), ...stand(21, 22, 60), ...stand(33, 34, 60)])
    expect(events).toEqual([])
  })

  it('ignores fixes worse than the accuracy limit', () => {
    const { events } = feed([...run(0, 20, 0, 3, 3), ...stand(21, 30, 60, 40)])
    expect(events).toEqual([])
  })

  it('resumes after moving on for the resume hold, from the first moving fix', () => {
    const { events } = feed([
      ...run(0, 20, 0, 3, 3),
      ...stand(21, 40, 60),
      ...run(41, 50, 60, 3, 3),
    ])
    expect(events.map((e) => e.event.kind)).toEqual(['stop', 'resume'])
    // Moving from 41 s; 3 s held at 44 s, by then 9 m away; the 10 m gate passes at 45 s
    expect(events[1]).toEqual({ s: 45, event: { kind: 'resume', fromTimestamp: 41_000 } })
  })

  it('never resumes on GPS drift while standing (#68 pattern)', () => {
    const { events } = feed([...run(0, 20, 0, 3, 3), ...stand(21, 30, 60), ...drift(31, 200, 60)])
    expect(events.map((e) => e.event.kind)).toEqual(['stop'])
  })

  it('a slow walk with a GPS speed reading biased slow never stops', () => {
    // 1.0 m/s on the ground, the GPS speed reading 35% slow (#171)
    const { events } = feed(run(0, 120, 0, 1, 0.65))
    expect(events).toEqual([])
  })

  it('resumes at walking speed when the GPS speed reading is biased slow', () => {
    // 1.3 m/s on the ground reads 0.85: positions lift it over the resume speed
    const { events } = feed([
      ...run(0, 20, 0, 3, 3),
      ...stand(21, 30, 60),
      ...run(31, 50, 60, 1.3, 0.85),
    ])
    expect(events.map((e) => e.event.kind)).toEqual(['stop', 'resume'])
  })

  it('decides from positions when fixes carry no GPS speed', () => {
    const { events } = feed([...run(0, 20, 0, 3), ...run(21, 30, 60, 0), ...run(31, 50, 60, 3)])
    expect(events.map((e) => e.event.kind)).toEqual(['stop', 'resume'])
  })

  describe('with the motion level', () => {
    /** Interleave a motion level each second with the fixes */
    const withMotion = (inputs: AutoPauseInput[], level: (s: number) => number) =>
      inputs.flatMap((i) => [motion(i.at / 1000, level(i.at / 1000)), i])

    it('a still phone stops even while GPS drifts without a speed reading', () => {
      const inputs = withMotion([...run(0, 20, 0, 3), ...drift(21, 40, 60, false)], (s) =>
        s <= 20 ? 4 : 0.05,
      )
      const { events } = feed(inputs)
      expect(events.map((e) => e.event.kind)).toEqual(['stop'])
    })

    it('handling the phone while standing does not resume without GPS movement', () => {
      const inputs = withMotion([...run(0, 20, 0, 3, 3), ...stand(21, 60, 60)], () => 4)
      const { events } = feed(inputs)
      expect(events.map((e) => e.event.kind)).toEqual(['stop'])
    })

    it('a phone lying still vetoes a resume, however GPS moves', () => {
      const inputs = withMotion(
        [...run(0, 20, 0, 3, 3), ...stand(21, 30, 60), ...run(31, 50, 60, 3, 3)],
        (s) => (s <= 20 ? 4 : 0.05),
      )
      const { events } = feed(inputs)
      expect(events.map((e) => e.event.kind)).toEqual(['stop'])
    })

    it('a motion level gone quiet leaves GPS to decide alone', () => {
      // One still level at 21 s, then no more: by the time GPS moves on it no longer vetoes
      const inputs = [
        ...withMotion(run(0, 20, 0, 3, 3), () => 4),
        motion(21, 0.05),
        ...stand(21, 30, 60),
        ...run(31, 50, 60, 3, 3),
      ]
      const { events } = feed(inputs)
      expect(events.map((e) => e.event.kind)).toEqual(['stop', 'resume'])
    })
  })
})
