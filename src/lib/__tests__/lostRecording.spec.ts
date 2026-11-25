import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '@/lib/geo'
import type { RunPause } from '@/lib/runPauses'
import { lostRecordingAt, recordingGap } from '@/lib/lostRecording'

const fix = (timestamp: number, over: Partial<TrackPoint> = {}): TrackPoint => ({
  lat: 52 + timestamp / 1e9,
  lon: 4,
  timestamp,
  accuracy: 5,
  ...over,
})

const autoPause = (over: Partial<RunPause> = {}): RunPause => ({
  position: 0,
  kind: 'auto',
  startedAt: 50_000,
  endedAt: null,
  startedElapsedMs: 40_000,
  lat: 52,
  lon: 4,
  ...over,
})

const running = { status: 'running' as const, startedAt: 1_000, segmentStartedAt: 1_000 }
const paused = { status: 'paused' as const, startedAt: 1_000, segmentStartedAt: null }

describe('lostRecordingAt (#81)', () => {
  it('marks a run killed while running at its last stored fix', () => {
    expect(lostRecordingAt(running, [], [[fix(2_000), fix(30_000)]])).toBe(30_000)
  })

  it('marks a run killed before its first fix where the open segment started', () => {
    expect(lostRecordingAt({ ...running, segmentStartedAt: 9_000 }, [], [[], []])).toBe(9_000)
    expect(lostRecordingAt({ ...running, segmentStartedAt: null }, [], [[]])).toBe(1_000)
  })

  it('marks a run killed while auto-paused where the pause began, when that is later', () => {
    expect(lostRecordingAt(paused, [autoPause()], [[fix(2_000), fix(45_000)]])).toBe(50_000)
    expect(lostRecordingAt(paused, [autoPause({ startedAt: 40_000 })], [[fix(45_000)]])).toBe(
      45_000,
    )
  })

  it('leaves a run killed during a manual pause unmarked: nothing was being recorded', () => {
    expect(lostRecordingAt(paused, [], [[fix(2_000)]])).toBeNull()
    // A closed auto-pause is history, not a sign it was still recording
    expect(lostRecordingAt(paused, [autoPause({ endedAt: 60_000 })], [[fix(2_000)]])).toBeNull()
  })
})

describe('recordingGap (#81)', () => {
  it('is null for a run that lost nothing', () => {
    expect(recordingGap(null, [[fix(1_000)]])).toBeNull()
  })

  it('has no end when recording never came back, with the last fix as its spot', () => {
    const last = fix(30_000)
    expect(recordingGap(30_000, [[fix(1_000), last]])).toEqual({
      from: 30_000,
      to: null,
      spot: [last.lon, last.lat],
    })
  })

  it('ends at the first fix after a resume', () => {
    const gap = recordingGap(30_000, [
      [fix(1_000), fix(30_000)],
      [fix(90_000), fix(95_000)],
    ])
    expect(gap).toMatchObject({ from: 30_000, to: 90_000 })
  })

  it('puts the spot on the last accurate fix, or any fix when none is accurate', () => {
    const good = fix(20_000)
    const bad = fix(30_000, { accuracy: 500, lat: 10 })
    expect(recordingGap(30_000, [[good, bad]])?.spot).toEqual([good.lon, good.lat])
    expect(recordingGap(30_000, [[bad]])?.spot).toEqual([bad.lon, bad.lat])
    expect(recordingGap(30_000, [[]])?.spot).toBeNull()
  })
})
