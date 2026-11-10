import { watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRunStore } from '@/stores/run'
import { initStepCueState, nextStepCue, type StepCueState } from '@/lib/stepCues'
import type { TimelineStep } from '@/lib/stepProgress'
import { speak } from '@/lib/speech'
import { vibrateStepChange } from '@/lib/haptics'

/**
 * Speaks and vibrates at a session's step changes while a run of it is going (#66). `timeline`
 * is the one `useSessionSteps` loads. The state starts from the step under way when the run is
 * first seen running, so a resume or a recovered run never repeats what was said. With the
 * setting off the state still moves on, so turning it on later does not catch up.
 */
export function useStepCues(timeline: Ref<TimelineStep[]>, enabled: Ref<boolean>) {
  const { status, runSteps, elapsedMs, distanceM } = storeToRefs(useRunStore())
  let state: StepCueState | null = null

  watch([status, runSteps, elapsedMs, distanceM, timeline], () => {
    if (status.value === 'idle' || status.value === 'finished') state = null
    if (status.value !== 'running' || timeline.value.length === 0) return
    const totals = { elapsedMs: elapsedMs.value, distanceM: distanceM.value }
    state ??= initStepCueState(timeline.value, runSteps.value, totals)
    const cue = nextStepCue(state, timeline.value, runSteps.value, totals)
    if (!cue) return
    state = cue.state
    if (!enabled.value) return
    void speak(cue.text)
    if (cue.vibrate) void vibrateStepChange()
  })
}
