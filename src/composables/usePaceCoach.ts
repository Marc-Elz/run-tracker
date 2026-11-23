import { computed, ref, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRunStore } from '@/stores/run'
import { nextPaceCue, restartWindow, type PaceCoachState } from '@/lib/paceCoach'
import { walkFloorFor } from '@/lib/walkPace'
import type { SessionType } from '@/lib/training'
import { isSpeaking, speak } from '@/lib/speech'

/** The walk floor (#153) and what decides whether this run's walk steps get it */
export interface WalkCoaching {
  /** The "Slowest walk" pace, null when off or unknown */
  floor: Ref<number | null>
  /** The linked session's type, null for a free run or while it loads */
  sessionType: Ref<SessionType | null>
  /** "Also during run/walk breaks" */
  breaks: Ref<boolean>
}

const noWalkFloor: WalkCoaching = { floor: ref(null), sessionType: ref(null), breaks: ref(false) }

/**
 * Speaks pace corrections on the open step of a session run (#103). Only while running and
 * switched on. A resume restarts the window, so the slowdown before a stop is not judged
 * (#154); a new step or a switch-off starts over. No vibration: that is kept for step changes.
 * A walk step without its own pace is coached against the walk floor where it applies (#153).
 */
export function usePaceCoach(
  enabled: Ref<boolean>,
  slowestRunPace: Ref<number>,
  walk: WalkCoaching = noWalkFloor,
) {
  const { status, runSteps, elapsedMs, distanceM } = storeToRefs(useRunStore())
  const walkFloor = computed(() =>
    walkFloorFor(walk.sessionType.value, walk.floor.value, walk.breaks.value),
  )
  let state: PaceCoachState | null = null
  let wasPaused = false

  watch([status, runSteps, elapsedMs, distanceM, enabled], () => {
    if (status.value === 'idle' || status.value === 'finished' || !enabled.value) state = null
    const resumed = wasPaused && status.value === 'running'
    wasPaused = status.value === 'paused'
    if (status.value !== 'running' || !enabled.value) return
    const last = runSteps.value[runSteps.value.length - 1]
    if (!last || last.endedElapsedMs !== null) return // no session, or the session is done
    const totals = { elapsedMs: elapsedMs.value, distanceM: distanceM.value }
    if (resumed && state) state = restartWindow(state, totals)
    const floors = { run: slowestRunPace.value, walk: walkFloor.value }
    const result = nextPaceCue(state, last, totals, floors, isSpeaking())
    state = result.state
    if (result.cue) void speak(result.cue.text)
  })
}
