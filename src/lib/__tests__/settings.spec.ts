import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  autoPause,
  cueConfig,
  followedProgramId,
  loadAutoPause,
  loadCueConfig,
  loadFollowedProgram,
  loadSlowestRunPace,
  loadSlowestWalk,
  loadStepCoaching,
  setAutoPause,
  setCueConfig,
  setFollowedProgram,
  setSlowestRunPace,
  setSlowestWalk,
  setStepCoaching,
  slowestRunPace,
  slowestWalk,
  stepCoaching,
  loadTimerPresets,
  setTimerPresets,
  timerPresets,
} from '../settings'
import { DEFAULT_PRESET } from '../timer'

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

describe('slowest walk (#153)', () => {
  const KEY = 'run-tracker.slowest-walk'

  it('is off by default, with no typed pace', () => {
    expect(loadSlowestWalk()).toEqual({ on: false, typed: null, breaks: false })
  })

  it('keeps a choice', () => {
    setSlowestWalk({ on: true, typed: 635, breaks: true })
    expect(slowestWalk.value).toEqual({ on: true, typed: 635, breaks: true })
    expect(loadSlowestWalk()).toEqual({ on: true, typed: 635, breaks: true })
  })

  it('falls back to the defaults for corrupt or out-of-range values', () => {
    localStorage.setItem(KEY, '{not json')
    expect(loadSlowestWalk()).toEqual({ on: false, typed: null, breaks: false })
    localStorage.setItem(KEY, JSON.stringify({ on: 'yes', typed: 300, breaks: true }))
    expect(loadSlowestWalk()).toEqual({ on: false, typed: null, breaks: true })
    localStorage.setItem(KEY, JSON.stringify({ on: true, typed: 1201 }))
    expect(loadSlowestWalk()).toEqual({ on: true, typed: null, breaks: false })
    localStorage.setItem(KEY, JSON.stringify({ on: true, typed: 630.5 }))
    expect(loadSlowestWalk().typed).toBeNull()
  })
})

describe('auto-pause (#154)', () => {
  it('is on by default and when storage is unreadable', () => {
    expect(loadAutoPause()).toBe(true)
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
    })
    expect(loadAutoPause()).toBe(true)
  })

  it('keeps it switched off, and on again', () => {
    setAutoPause(false)
    expect(autoPause.value).toBe(false)
    expect(loadAutoPause()).toBe(false)
    setAutoPause(true)
    expect(loadAutoPause()).toBe(true)
  })
})

describe('timer presets', () => {
  const plank = { id: 'p', name: 'Plank set', workS: 45, restS: 15, rounds: 4 }

  it('starts with only the 2-minute default', () => {
    expect(loadTimerPresets()).toEqual([DEFAULT_PRESET])
  })

  it('survives a restart, default first', () => {
    expect(setTimerPresets([plank])).toBe(true)
    expect(timerPresets.value).toEqual([DEFAULT_PRESET, plank])
    expect(loadTimerPresets()).toEqual([DEFAULT_PRESET, plank])
  })

  it('keeps an edited default, and brings it back when it was removed', () => {
    const edited = { ...DEFAULT_PRESET, workS: 90, name: 'Short' }
    setTimerPresets([edited, plank])
    expect(loadTimerPresets()[0]).toEqual(edited)
    setTimerPresets([plank])
    expect(loadTimerPresets()).toEqual([DEFAULT_PRESET, plank])
  })

  it('falls back to the default for garbage and skips malformed presets', () => {
    localStorage.setItem('run-tracker.timer-presets', '{not json')
    expect(loadTimerPresets()).toEqual([DEFAULT_PRESET])
    localStorage.setItem('run-tracker.timer-presets', JSON.stringify([plank, { id: 'x' }]))
    expect(loadTimerPresets()).toEqual([DEFAULT_PRESET, plank])
  })

  it('reports a failed save and leaves the list unchanged', () => {
    setTimerPresets([])
    vi.stubGlobal('localStorage', {
      ...memoryStorage(),
      setItem: () => {
        throw new Error('quota')
      },
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(setTimerPresets([plank])).toBe(false)
    expect(timerPresets.value).toEqual([DEFAULT_PRESET])
  })
})
