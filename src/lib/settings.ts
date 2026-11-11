import { ref } from 'vue'
import {
  CUE_DISTANCE_OPTIONS,
  CUE_TIME_OPTIONS,
  DEFAULT_CUE_CONFIG,
  type CueConfig,
  type CueDistanceKm,
  type CueTimeMin,
} from '@/lib/cues'
import {
  DEFAULT_SLOWEST_RUN_PACE,
  SLOWEST_RUN_PACE_OPTIONS,
  type SlowestRunPace,
} from '@/lib/paceCoach'

const CUES_KEY = 'run-tracker.cues'

/** Saved cue choice; anything missing, unreadable or out of range falls back to the default. */
export function loadCueConfig(): CueConfig {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CUES_KEY) ?? 'null')
    if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_CUE_CONFIG }
    const { distanceKm, timeMin } = raw as Record<string, unknown>
    return {
      distanceKm: CUE_DISTANCE_OPTIONS.includes(distanceKm as CueDistanceKm)
        ? (distanceKm as CueDistanceKm)
        : DEFAULT_CUE_CONFIG.distanceKm,
      timeMin: CUE_TIME_OPTIONS.includes(timeMin as CueTimeMin)
        ? (timeMin as CueTimeMin)
        : DEFAULT_CUE_CONFIG.timeMin,
    }
  } catch {
    return { ...DEFAULT_CUE_CONFIG }
  }
}

/** Shared by Settings and the run screen, so a change applies to a run in progress. */
export const cueConfig = ref<CueConfig>(loadCueConfig())

export function setCueConfig(next: CueConfig) {
  cueConfig.value = next
  try {
    localStorage.setItem(CUES_KEY, JSON.stringify(next))
  } catch (err) {
    console.warn('Could not save settings', err)
  }
}

const FOLLOWED_KEY = 'run-tracker.followed-program'

/** The program whose next session the Run screen offers (#40); null when none is followed. */
export function loadFollowedProgram(): string | null {
  try {
    const id = localStorage.getItem(FOLLOWED_KEY)
    return id === null || id === '' ? null : id
  } catch {
    return null
  }
}

/** Kept on this phone only; it can name a program that was deleted since, which reads as none. */
export const followedProgramId = ref<string | null>(loadFollowedProgram())

export function setFollowedProgram(id: string | null) {
  followedProgramId.value = id
  try {
    if (id === null) localStorage.removeItem(FOLLOWED_KEY)
    else localStorage.setItem(FOLLOWED_KEY, id)
  } catch (err) {
    console.warn('Could not save settings', err)
  }
}

const STEP_COACHING_KEY = 'run-tracker.step-announcements'

/**
 * Coaching in a training session: spoken steps and vibration (#66), plus pace corrections
 * (#103) when asked for. The key and its 'on'/'off' values predate #103: 'on' still means steps.
 */
export type StepCoaching = 'off' | 'steps' | 'pace'
const STORED: Record<StepCoaching, string> = { off: 'off', steps: 'on', pace: 'pace' }

/** Steps unless switched off or up; corrections are opt-in. */
export function loadStepCoaching(): StepCoaching {
  try {
    const raw = localStorage.getItem(STEP_COACHING_KEY)
    if (raw === STORED.off) return 'off'
    if (raw === STORED.pace) return 'pace'
    return 'steps'
  } catch {
    return 'steps'
  }
}

export const stepCoaching = ref<StepCoaching>(loadStepCoaching())

export function setStepCoaching(next: StepCoaching) {
  stepCoaching.value = next
  try {
    localStorage.setItem(STEP_COACHING_KEY, STORED[next])
  } catch (err) {
    console.warn('Could not save settings', err)
  }
}

const SLOWEST_RUN_PACE_KEY = 'run-tracker.slowest-run-pace'

/** Slower than this on a run step without a pace gets "Faster" (#103); s/km */
export function loadSlowestRunPace(): SlowestRunPace {
  try {
    const raw = Number(localStorage.getItem(SLOWEST_RUN_PACE_KEY))
    return SLOWEST_RUN_PACE_OPTIONS.includes(raw as SlowestRunPace)
      ? (raw as SlowestRunPace)
      : DEFAULT_SLOWEST_RUN_PACE
  } catch {
    return DEFAULT_SLOWEST_RUN_PACE
  }
}

export const slowestRunPace = ref<SlowestRunPace>(loadSlowestRunPace())

export function setSlowestRunPace(next: SlowestRunPace) {
  slowestRunPace.value = next
  try {
    localStorage.setItem(SLOWEST_RUN_PACE_KEY, String(next))
  } catch (err) {
    console.warn('Could not save settings', err)
  }
}
