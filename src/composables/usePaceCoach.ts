import { watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRunStore } from '@/stores/run'
import { nextPaceCue, restartWindow, type PaceCoachState } from '@/lib/paceCoach'
import { isSpeaking, speak } from '@/lib/speech'

/**
 * Speaks pace corrections on the open step of a session run (#103). Only while running and
 * switched on. A resume restarts the window, so the slowdown before a stop is not judged
 * (#154); a new step or a switch-off starts over. No vibration: that is kept for step changes.
 */
export function usePaceCoach(enabled: Ref<boolean>, slowestRunPace: Ref<number>) {
  const { status, runSteps, elapsedMs, distanceM } = storeToRefs(useRunStore())
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
    const result = nextPaceCue(state, last, totals, slowestRunPace.value, isSpeaking())
    state = result.state
    if (result.cue) void speak(result.cue.text)
  })
}
