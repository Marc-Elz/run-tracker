import { describe, expect, it } from 'vitest'
import { closePause, pauseList, type RunPause } from '../runPauses'

const pause = (position: number, over: Partial<RunPause> = {}): RunPause => ({
  position,
  kind: 'auto',
  startedAt: 100_000 + position * 60_000,
  endedAt: 100_000 + position * 60_000 + 20_000,
  startedElapsedMs: position * 50_000,
  lat: 52.1,
  lon: 4.2,
  ...over,
})

describe('closePause (#154)', () => {
  it('ends a pause at the given time, never before it started', () => {
    const open = pause(0, { endedAt: null })
    expect(closePause(open, 130_000).endedAt).toBe(130_000)
    expect(closePause(open, 50_000).endedAt).toBe(100_000)
  })
})

describe('pauseList (#154)', () => {
  it('lists the auto-pauses in order with their length, spot and total', () => {
    const { rows, totalMs } = pauseList([pause(1, { endedAt: 205_000 }), pause(0)])
    expect(rows).toEqual([
      { position: 0, startedAt: 100_000, durationMs: 20_000, spot: [4.2, 52.1] },
      { position: 1, startedAt: 160_000, durationMs: 45_000, spot: [4.2, 52.1] },
    ])
    expect(totalMs).toBe(65_000)
  })

  it('has no spot without a fix, counts an open pause as zero, and leaves manual pauses out', () => {
    const { rows, totalMs } = pauseList([
      pause(0, { lat: null, lon: null }),
      pause(1, { endedAt: null }),
      pause(2, { kind: 'manual' }),
    ])
    expect(rows.map((r) => [r.position, r.durationMs, r.spot])).toEqual([
      [0, 20_000, null],
      [1, 0, [4.2, 52.1]],
    ])
    expect(totalMs).toBe(20_000)
  })

  it('is empty for a run without pauses', () => {
    expect(pauseList([])).toEqual({ rows: [], totalMs: 0 })
  })
})
