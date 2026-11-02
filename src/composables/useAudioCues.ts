import { watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRunStore } from '@/stores/run'
import { initCueState, nextCue, retargetCueState, type CueConfig, type CueState } from '@/lib/cues'
import { speak } from '@/lib/speech'

/** Speaks a cue at each distance / time threshold while a run is in progress. */
export function useAudioCues(config: Ref<CueConfig>) {
  const { status, distanceM, elapsedMs } = storeToRefs(useRunStore())
  // Created when the run is first seen running (a start, or a resume after recovery), so cues
  // never repeat; kept over pauses; dropped when the run ends
  let state: CueState | null = null

  watch([status, distanceM, elapsedMs], () => {
    if (status.value === 'idle' || status.value === 'finished') state = null
    if (status.value !== 'running') return
    if (state === null) {
      state = initCueState(distanceM.value, elapsedMs.value, config.value)
      return
    }
    const cue = nextCue(state, distanceM.value, elapsedMs.value, config.value)
    if (!cue) return
    state = cue.state
    void speak(cue.text)
  })

  watch(config, (next) => {
    if (state) state = retargetCueState(state, distanceM.value, elapsedMs.value, next)
  })
}
