import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../geo'
import {
  MAX_ACCURACY_M,
  paceSecPerKm,
  step,
  summarizeTrack,
  windowPaceSecPerKm,
} from '../runStats'

// Due north along a meridian: 0.0001 degrees of latitude is ~11.1 m
const M_PER_UNIT = 11.1195
const at = (seconds: number, units: number, accuracy = 5): TrackPoint => ({
  lat: 52 + units * 0.0001,
  lon: 4,
  timestamp: seconds * 1000,
  accuracy,
})

/** Steady run: one fix every `every` seconds, `units` of latitude per fix */
const steady = (count: number, every = 4, units = 1, from = 0) =>
  Array.from({ length: count }, (_, i) => at(from + i * every, i * units))

describe('step', () => {
  it('accepts the first accurate fix of a segment without distance', () => {
    expect(step(null, at(0, 0))).toEqual({ accepted: true, meters: 0, movingMs: 0 })
  })

  it('rejects fixes with poor accuracy, even the first one', () => {
    expect(step(null, at(0, 0, MAX_ACCURACY_M + 1)).accepted).toBe(false)
    expect(step(at(0, 0), at(4, 1, 50)).accepted).toBe(false)
  })

  it('accepts fixes with unknown accuracy', () => {
    const { accuracy: _, ...noAccuracy } = at(4, 1)
    expect(step(at(0, 0), noAccuracy).accepted).toBe(true)
  })

  it('rejects a jump that implies more than 30 km/h', () => {
    // ~111 m in 4 s is ~100 km/h
    expect(step(at(0, 0), at(4, 10)).accepted).toBe(false)
  })

  it('rejects jitter closer than the minimum step and out-of-order fixes', () => {
    expect(step(at(0, 0), at(1, 0.2)).accepted).toBe(false)
    expect(step(at(4, 0), at(4, 1)).accepted).toBe(false)
    expect(step(at(4, 0), at(2, 1)).accepted).toBe(false)
  })

  it('counts a running step as moving time and a slow drift as standing still', () => {
    expect(step(at(0, 0), at(4, 1))).toMatchObject({
      accepted: true,
      meters: expect.closeTo(M_PER_UNIT, 1),
      movingMs: 4000,
    })
    // 11 m over 60 s at a traffic light: distance counts, time does not
    expect(step(at(0, 0), at(60, 1))).toMatchObject({ accepted: true, movingMs: 0 })
  })
})

describe('summarizeTrack', () => {
  it('is zero for no points or a single point', () => {
    expect(summarizeTrack([])).toEqual({ distanceM: 0, movingMs: 0 })
    expect(summarizeTrack([[]])).toEqual({ distanceM: 0, movingMs: 0 })
    expect(summarizeTrack([[at(0, 0)]])).toEqual({ distanceM: 0, movingMs: 0 })
  })

  it('is zero when every fix is inaccurate', () => {
    const track = steady(10).map((p) => ({ ...p, accuracy: 100 }))
    expect(summarizeTrack([track])).toEqual({ distanceM: 0, movingMs: 0 })
  })

  it('sums a steady run', () => {
    const { distanceM, movingMs } = summarizeTrack([steady(11)])
    expect(distanceM).toBeCloseTo(10 * M_PER_UNIT, 0)
    expect(movingMs).toBe(40_000)
  })

  it('skips a jump without losing the distance around it', () => {
    const track = steady(11)
    track[5] = { ...track[5]!, lat: track[5]!.lat + 0.01 } // ~1.1 km off
    expect(summarizeTrack([track]).distanceM).toBeCloseTo(10 * M_PER_UNIT, 0)
  })

  it('skips inaccurate fixes but keeps the distance to the next good one', () => {
    const track = steady(11)
    track[5] = { ...track[5]!, accuracy: 80 }
    expect(summarizeTrack([track])).toMatchObject({ movingMs: 40_000 })
    expect(summarizeTrack([track]).distanceM).toBeCloseTo(10 * M_PER_UNIT, 0)
  })

  it('does not count standing still as moving time or jitter as distance', () => {
    const before = steady(6) // 0..20 s, 5 units
    // 60 s at a traffic light: fixes wander within a couple of metres
    const waiting = Array.from({ length: 60 }, (_, i) => at(21 + i, 5 + (i % 2) * 0.2))
    const after = Array.from({ length: 5 }, (_, i) => at(84 + i * 4, 6 + i))
    const { distanceM, movingMs } = summarizeTrack([[...before, ...waiting, ...after]])
    expect(distanceM).toBeCloseTo(10 * M_PER_UNIT, 0)
    // 20 s before + 16 s after; the 64 s from the last fix before the light to the first after is not moving
    expect(movingMs).toBe(36_000)
  })

  it('does not bridge a pause between segments', () => {
    const first = steady(6) // ends at 5 units
    const second = Array.from({ length: 6 }, (_, i) => at(100 + i * 4, 50 + i)) // resumes far away
    const { distanceM, movingMs } = summarizeTrack([first, second])
    expect(distanceM).toBeCloseTo(10 * M_PER_UNIT, 0)
    expect(movingMs).toBe(40_000)
  })
})

describe('paceSecPerKm', () => {
  it('is null below the minimum distance or without time', () => {
    expect(paceSecPerKm(60_000, 5)).toBeNull()
    expect(paceSecPerKm(0, 1000)).toBeNull()
  })

  it('is seconds per km', () => {
    expect(paceSecPerKm(330_000, 1000)).toBe(330)
  })
})

describe('windowPaceSecPerKm', () => {
  it('only uses fixes inside the window', () => {
    const track = steady(11) // 4 s per 11.1 m -> ~360 s/km
    expect(windowPaceSecPerKm(track, 20_000, 5)).toBeCloseTo(4 / (M_PER_UNIT / 1000), -1)
    expect(windowPaceSecPerKm(track, 40_000, 5)).toBeNull() // one fix left
  })
})
