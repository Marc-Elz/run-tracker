import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadCueConfig, setCueConfig, cueConfig } from '../settings'

// Node's own experimental localStorage can shadow jsdom's, so use a plain in-memory one
function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size
    },
  }
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', memoryStorage())
})

describe('cue settings', () => {
  it('defaults to a cue every km, no time cues', () => {
    expect(loadCueConfig()).toEqual({ distanceKm: 1, timeMin: 0 })
  })

  it('survives a restart', () => {
    setCueConfig({ distanceKm: 5, timeMin: 10 })
    expect(cueConfig.value).toEqual({ distanceKm: 5, timeMin: 10 })
    expect(loadCueConfig()).toEqual({ distanceKm: 5, timeMin: 10 })
  })

  it('falls back to defaults for garbage or out-of-range values', () => {
    localStorage.setItem('run-tracker.cues', '{not json')
    expect(loadCueConfig()).toEqual({ distanceKm: 1, timeMin: 0 })
    localStorage.setItem('run-tracker.cues', JSON.stringify({ distanceKm: 3, timeMin: 7 }))
    expect(loadCueConfig()).toEqual({ distanceKm: 1, timeMin: 0 })
  })

  it('keeps working when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      ...memoryStorage(),
      setItem: () => {
        throw new Error('quota')
      },
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => setCueConfig({ distanceKm: 2, timeMin: 0 })).not.toThrow()
    expect(cueConfig.value.distanceKm).toBe(2)
  })
})
