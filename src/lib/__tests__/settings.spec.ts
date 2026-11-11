import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cueConfig,
  followedProgramId,
  loadCueConfig,
  loadFollowedProgram,
  loadSlowestRunPace,
  loadStepCoaching,
  setCueConfig,
  setFollowedProgram,
  setSlowestRunPace,
  setStepCoaching,
  slowestRunPace,
  stepCoaching,
} from '../settings'

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

describe('followed program (#40)', () => {
  it('is none at first, survives a restart, and can be cleared', () => {
    expect(loadFollowedProgram()).toBeNull()
    setFollowedProgram('p1')
    expect(followedProgramId.value).toBe('p1')
    expect(loadFollowedProgram()).toBe('p1')
    setFollowedProgram(null)
    expect(followedProgramId.value).toBeNull()
    expect(loadFollowedProgram()).toBeNull()
  })

  it('reads as none when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      ...memoryStorage(),
      getItem: () => {
        throw new Error('blocked')
      },
    })
    expect(loadFollowedProgram()).toBeNull()
  })
})

describe('step coaching (#66, #103)', () => {
  it('is steps by default and when storage is unreadable', () => {
    expect(loadStepCoaching()).toBe('steps')
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
    })
    expect(loadStepCoaching()).toBe('steps')
  })

  it('reads the on/off saved before #103 as steps and off, so pace is opt-in', () => {
    localStorage.setItem('run-tracker.step-announcements', 'on')
    expect(loadStepCoaching()).toBe('steps')
    localStorage.setItem('run-tracker.step-announcements', 'off')
    expect(loadStepCoaching()).toBe('off')
  })

  it('keeps each choice', () => {
    for (const choice of ['off', 'pace', 'steps'] as const) {
      setStepCoaching(choice)
      expect(stepCoaching.value).toBe(choice)
      expect(loadStepCoaching()).toBe(choice)
    }
  })
})

describe('slowest run pace (#103)', () => {
  it('defaults to 9:00 /km, also for an unknown value', () => {
    expect(loadSlowestRunPace()).toBe(540)
    localStorage.setItem('run-tracker.slowest-run-pace', '777')
    expect(loadSlowestRunPace()).toBe(540)
  })

  it('keeps a choice', () => {
    setSlowestRunPace(600)
    expect(slowestRunPace.value).toBe(600)
    expect(loadSlowestRunPace()).toBe(600)
  })
})
