import { describe, expect, it } from 'vitest'
import type { RunRecord, StoredPoint } from '@/lib/db/runRepository'
import { buildRunSummary, toSegments } from '../runSummary'

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: 'r',
  status: 'finished',
  startedAt: 0,
  finishedAt: 100_000,
  elapsedMs: 100_000,
  segment: 0,
  segmentStartedAt: null,
  movingMs: 0,
  distanceM: 0,
  ...over,
})

// 11 m north every 2 s (5.5 m/s): a steady run, inside the speed and step filters
const fix = (i: number, segment = 0, lat = 52): StoredPoint => ({
  segment,
  timestamp: i * 2000,
  lat: lat + i * 0.0001,
  lon: 4,
  accuracy: 5,
})

describe('toSegments', () => {
  it('groups points by segment and keeps empty segments', () => {
    const segments = toSegments([fix(0), fix(1, 2)], 3)
    expect(segments.map((s) => s.length)).toEqual([1, 0, 1, 0])
    expect(segments[0]![0]).not.toHaveProperty('segment')
  })
})

describe('buildRunSummary', () => {
  it('computes totals from the raw points and draws the used ones', () => {
    const points = [fix(0), fix(1), fix(2), fix(3)]
    const summary = buildRunSummary(run({ elapsedMs: 6000 }), points)
    expect(summary.distanceM).toBeGreaterThan(30)
    expect(summary.movingMs).toBe(6000)
    expect(summary.lines).toHaveLength(1)
    expect(summary.lines[0]).toHaveLength(4)
    expect(summary.start).toEqual([4, 52])
    expect(summary.end![1]).toBeCloseTo(52.0003, 6)
    expect(summary.bounds).toEqual([4, 52, 4, summary.end![1]])
    expect(summary.avgPaceSecPerKm).toBeGreaterThan(0)
  })

  it('draws a pause gap as two lines, not one', () => {
    const points = [fix(0), fix(1), fix(2), fix(60, 1, 52.01), fix(61, 1, 52.01), fix(62, 1, 52.01)]
    const summary = buildRunSummary(run({ segment: 1 }), points)
    expect(summary.lines.map((l) => l.length)).toEqual([3, 3])
  })

  it('leaves out inaccurate fixes', () => {
    const noisy: StoredPoint = { ...fix(1), accuracy: 90 }
    const summary = buildRunSummary(run(), [fix(0), noisy, fix(2)])
    expect(summary.lines[0]).toHaveLength(2)
  })

  it('has no route and no pace without points', () => {
    const summary = buildRunSummary(run({ distanceM: 0 }), [])
    expect(summary.lines).toEqual([])
    expect(summary.start).toBeNull()
    expect(summary.end).toBeNull()
    expect(summary.bounds).toBeNull()
    expect(summary.avgPaceSecPerKm).toBeNull()
  })

  it('handles a single point: a marker but no distance', () => {
    const summary = buildRunSummary(run(), [fix(0)])
    expect(summary.start).toEqual(summary.end)
    expect(summary.distanceM).toBe(0)
    expect(summary.avgPaceSecPerKm).toBeNull()
  })
})
