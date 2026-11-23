import { describe, expect, it } from 'vitest'
import {
  closePause,
  killedPauseEnd,
  nextPausePosition,
  pauseList,
  type RunPause,
} from '../runPauses'

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

describe('nextPausePosition (#154)', () => {
  it('comes after the highest stored position, so a gap is never filled over a stored row', () => {
    expect(nextPausePosition([])).toBe(0)
    // Pause 0 was never stored (both writes failed), pause 1 was
    expect(nextPausePosition([pause(1)])).toBe(2)
  })
})

describe('killedPauseEnd (#154)', () => {
  const fix = (timestamp: number) => ({ lat: 52, lon: 4, timestamp })
  it('ends where the next segment starts, not at a later fix', () => {
    const segments = [
      [fix(1_000), fix(10_000)],
      [fix(30_000), fix(1_800_000)],
    ]
    expect(killedPauseEnd(pause(0, { startedAt: 14_000 }), segments)).toBe(30_000)
  })

  it('ends at the last fix when the run never moved on, or at its start without fixes', () => {
    expect(killedPauseEnd(pause(0, { startedAt: 14_000 }), [[fix(1_000), fix(10_000)]])).toBe(
      10_000,
    )
    expect(killedPauseEnd(pause(0, { startedAt: 14_000 }), [])).toBe(14_000)
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
