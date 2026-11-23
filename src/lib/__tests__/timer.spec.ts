import { describe, expect, it } from 'vitest'
import {
  autoPresetName,
  buildTimeline,
  DEFAULT_PRESET,
  displaySeconds,
  phaseCue,
  presetDetail,
  presetError,
  timerState,
  toPreset,
  totalSeconds,
  withDefaultPreset,
  type TimerPreset,
} from '../timer'

const plank: TimerPreset = { id: 'p', name: 'Plank set', workS: 45, restS: 15, rounds: 4 }

describe('buildTimeline', () => {
  it('is one work phase for the 2-minute default', () => {
    expect(buildTimeline(DEFAULT_PRESET)).toEqual([
      { kind: 'work', round: 1, startS: 0, endS: 120 },
    ])
  })

  it('puts rest between rounds, not after the last', () => {
    const t = buildTimeline(plank)
    expect(t.map((p) => p.kind)).toEqual(['work', 'rest', 'work', 'rest', 'work', 'rest', 'work'])
    expect(t[1]).toEqual({ kind: 'rest', round: 1, startS: 45, endS: 60 })
    expect(t[t.length - 1]).toEqual({ kind: 'work', round: 4, startS: 180, endS: 225 })
    expect(totalSeconds(plank)).toBe(225)
  })

  it('has no rest phases when rest is 0', () => {
    const t = buildTimeline({ ...plank, restS: 0 })
    expect(t.map((p) => p.kind)).toEqual(['work', 'work', 'work', 'work'])
    expect(totalSeconds({ ...plank, restS: 0 })).toBe(180)
  })
})

describe('timerState', () => {
  const t = buildTimeline(plank)

  it('shows the full time at the start and counts down within a phase', () => {
    expect(timerState(t, 0)).toEqual({ index: 0, remainingMs: 45_000, done: false })
    expect(displaySeconds(timerState(t, 0).remainingMs)).toBe(45)
    expect(displaySeconds(timerState(t, 44_100).remainingMs)).toBe(1)
  })

  it('moves to the next phase exactly at its start', () => {
    expect(timerState(t, 45_000).index).toBe(1)
    expect(timerState(t, 59_999).index).toBe(1)
    expect(timerState(t, 60_000).index).toBe(2)
  })

  it('is done at the end and stays done', () => {
    expect(timerState(t, 225_000)).toEqual({ index: 7, remainingMs: 0, done: true })
    expect(timerState(t, 999_000).done).toBe(true)
  })
})

describe('phaseCue', () => {
  const t = buildTimeline(plank)
  it('names the round of a work phase, rest, and the end', () => {
    expect(phaseCue(t, 0, 4)).toBe('Round 1 of 4, work')
    expect(phaseCue(t, 1, 4)).toBe('Rest')
    expect(phaseCue(t, 2, 4)).toBe('Round 2 of 4, work')
    expect(phaseCue(t, 7, 4)).toBe('Done')
  })

  it('says Go for a plain countdown', () => {
    expect(phaseCue(buildTimeline(DEFAULT_PRESET), 0, 1)).toBe('Go')
  })
})

describe('preset text', () => {
  it('describes a plain countdown by its time and a set by its parts', () => {
    expect(presetDetail(DEFAULT_PRESET)).toBe('2:00')
    expect(presetDetail(plank)).toBe('0:45 work · 0:15 rest · 4×')
    expect(presetDetail({ ...plank, restS: 0 })).toBe('0:45 work · 4×')
  })

  it('names a preset from its times when no name is typed', () => {
    expect(autoPresetName({ workS: 90, restS: 0, rounds: 1 })).toBe('1:30')
    expect(autoPresetName({ workS: 45, restS: 15, rounds: 4 })).toBe('0:45 / 0:15 × 4')
    expect(autoPresetName({ workS: 45, restS: 0, rounds: 3 })).toBe('0:45 × 3')
  })
})

describe('presetError', () => {
  it('accepts a sensible preset', () => {
    expect(presetError(plank)).toBeNull()
  })

  it('rejects too short work, negative or unreadable rest, and rounds out of range', () => {
    expect(presetError({ ...plank, workS: 4 })).toMatch(/work/)
    expect(presetError({ ...plank, workS: NaN })).toMatch(/work/)
    expect(presetError({ ...plank, restS: -1 })).toMatch(/rest/)
    expect(presetError({ ...plank, restS: NaN })).toMatch(/rest/)
    expect(presetError({ ...plank, rounds: 0 })).toMatch(/Rounds/)
    expect(presetError({ ...plank, rounds: 100 })).toMatch(/Rounds/)
  })
})

describe('stored presets', () => {
  it('reads back a valid preset and drops malformed ones', () => {
    expect(toPreset(plank)).toEqual(plank)
    expect(toPreset({ ...plank, name: '  ' })?.name).toBe('0:45 / 0:15 × 4')
    expect(toPreset({ ...plank, workS: 'x' })).toBeNull()
    expect(toPreset({ ...plank, id: '' })).toBeNull()
    expect(toPreset(null)).toBeNull()
  })

  it('always lists the default first, restoring it when missing, without repeats', () => {
    expect(withDefaultPreset([])).toEqual([DEFAULT_PRESET])
    const edited = { ...DEFAULT_PRESET, workS: 180, name: '3 minutes' }
    expect(withDefaultPreset([plank, edited, plank])).toEqual([edited, plank])
  })
})
