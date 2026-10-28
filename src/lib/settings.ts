import { ref } from 'vue'
import {
  CUE_DISTANCE_OPTIONS,
  CUE_TIME_OPTIONS,
  DEFAULT_CUE_CONFIG,
  type CueConfig,
  type CueDistanceKm,
  type CueTimeMin,
} from '@/lib/cues'

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
