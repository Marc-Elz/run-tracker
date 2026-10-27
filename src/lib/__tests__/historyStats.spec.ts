import { describe, expect, it } from 'vitest'
import type { RunRecord } from '@/lib/db/runRepository'
import { startOfMonth, startOfWeek, summarizeRuns } from '../historyStats'

const run = (startedAt: number, distanceM: number, elapsedMs = 600_000): RunRecord => ({
  id: String(startedAt),
  name: null,
  status: 'finished',
  startedAt,
  finishedAt: startedAt + elapsedMs,
  elapsedMs,
  segment: 0,
  segmentStartedAt: null,
  movingMs: elapsedMs,
  distanceM,
})

// Local-time dates so the tests hold in any time zone. 2026-10-28 is a Wednesday.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()
const now = at(2026, 10, 28)

describe('startOfWeek / startOfMonth', () => {
  it('starts the week on Monday, also when now is a Sunday or a Monday', () => {
    expect(startOfWeek(now)).toBe(at(2026, 10, 26, 0))
    expect(startOfWeek(at(2026, 11, 1, 23))).toBe(at(2026, 10, 26, 0))
    expect(startOfWeek(at(2026, 10, 26, 0))).toBe(at(2026, 10, 26, 0))
  })

  it('starts the month on the 1st', () => {
    expect(startOfMonth(now)).toBe(at(2026, 10, 1, 0))
  })
})

describe('summarizeRuns', () => {
  it('is all zeros with no runs', () => {
    const s = summarizeRuns([], now)
    expect(s.all).toEqual({ count: 0, distanceM: 0, elapsedMs: 0 })
    expect(s.week.count).toBe(0)
    expect(s.longestM).toBe(0)
    expect(s.bestPaceSecPerKm).toBeNull()
  })

  it('buckets runs by week and month, with Sunday night before and Monday morning inside the week', () => {
    const s = summarizeRuns(
      [
        run(at(2026, 10, 25, 23), 5000), // Sunday night, previous week, same month
        run(at(2026, 10, 26, 0), 3000), // Monday 00:00, this week
        run(at(2026, 9, 30, 20), 8000), // previous month
      ],
      now,
    )
    expect(s.week).toEqual({ count: 1, distanceM: 3000, elapsedMs: 600_000 })
    expect(s.month).toEqual({ count: 2, distanceM: 8000, elapsedMs: 1_200_000 })
    expect(s.all).toEqual({ count: 3, distanceM: 16_000, elapsedMs: 1_800_000 })
  })

  it('takes the longest run over all periods', () => {
    const s = summarizeRuns([run(at(2026, 1, 5), 21_100), run(at(2026, 10, 27), 4000)], now)
    expect(s.longestM).toBe(21_100)
  })

  it('picks the fastest pace and ignores runs under 1 km', () => {
    const s = summarizeRuns(
      [
        run(at(2026, 10, 1), 5000, 1_500_000), // 300 s/km
        run(at(2026, 10, 2), 10_000, 2_700_000), // 270 s/km
        run(at(2026, 10, 3), 50, 5000), // 100 s/km blip, too short
      ],
      now,
    )
    expect(s.bestPaceSecPerKm).toBeCloseTo(270)
  })

  it('has no best pace when every run is under 1 km', () => {
    expect(summarizeRuns([run(at(2026, 10, 3), 900, 300_000)], now).bestPaceSecPerKm).toBeNull()
  })
})
