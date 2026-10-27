import { describe, expect, it } from 'vitest'
import { formatDistanceKm, formatDuration, formatPace, runTitle } from '../format'

describe('formatDuration', () => {
  it('formats minutes and seconds', () => expect(formatDuration(65_000)).toBe('01:05'))
  it('adds hours when needed', () => expect(formatDuration(3_725_000)).toBe('1:02:05'))
  it('clamps negatives to zero', () => expect(formatDuration(-5)).toBe('00:00'))
})

describe('formatPace', () => {
  it('formats sec/km as m:ss', () => expect(formatPace(330)).toBe('5:30'))
  it('rounds 59.6 seconds up into the next minute', () => expect(formatPace(359.6)).toBe('6:00'))
  it('shows a placeholder when unknown', () => {
    expect(formatPace(null)).toBe('--:--')
    expect(formatPace(Infinity)).toBe('--:--')
    expect(formatPace(0)).toBe('--:--')
  })
  it('hides walking-pace noise', () => expect(formatPace(4000)).toBe('--:--'))
})

describe('runTitle', () => {
  const startedAt = Date.UTC(2026, 9, 26, 7, 12)
  it('is the name when there is one', () =>
    expect(runTitle({ name: 'Morning loop', startedAt })).toBe('Morning loop'))
  it('falls back to the date and time', () =>
    expect(runTitle({ name: null, startedAt })).toMatch(/^\w{3} \d{1,2} \w{3} · \d{2}:\d{2}$/))
})

describe('formatDistanceKm', () => {
  it('uses two decimals', () => expect(formatDistanceKm(2345)).toBe('2.35'))
})
