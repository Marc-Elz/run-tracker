import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRunStore } from '@/stores/run'
import {
  AUTO_PAUSE_PHRASES,
  describeFix,
  initAutoPauseState,
  nextAutoPause,
  type AutoPauseInput,
  type AutoPausePhrase,
  type AutoPauseState,
} from '@/lib/autoPause'
import type { TrackPoint } from '@/lib/geo'
import { isSpeaking, speak } from '@/lib/speech'

/** How often a held-back line checks whether other speech is over */
const WAIT_POLL_MS = 250

/**
 * Auto-pause (#154) on the run screen. Returns `onFix`, the one GPS callback: it stores the fix
 * (`run.addPoint`) first, so the fix that shows a stop is still in the running segment, then
 * feeds the detector. Works while the run is running or auto-paused and the setting is on.
 *
 * `speak()` cuts off the line playing, so "Stop detected" waits for other speech to end, and
 * "Resumed" is left out when a step announcement comes with the resume (elapsed time jumps on
 * by the seconds it took to confirm, so a timed step can end right then).
 */
export function useAutoPause(enabled: Ref<boolean>) {
  const run = useRunStore()
  const { status, pauseKind } = storeToRefs(run)
  let state: AutoPauseState = initAutoPauseState()
  let waiting: ReturnType<typeof setInterval> | null = null
  // The next status change is the detector's own (an auto-pause or auto-resume)
  let ownChange = false

  function stopWaiting() {
    if (waiting !== null) clearInterval(waiting)
    waiting = null
  }

  function say(key: AutoPausePhrase) {
    stopWaiting()
    const text = AUTO_PAUSE_PHRASES[key]
    if (!isSpeaking()) return void speak(text)
    waiting = setInterval(() => {
      if (isSpeaking()) return
      stopWaiting()
      void speak(text)
    }, WAIT_POLL_MS)
  }

  async function sayResumed() {
    stopWaiting()
    // Let the step cues see the new totals first; anything speaking now came with the resume
    await nextTick()
    if (status.value === 'running' && !isSpeaking()) void speak(AUTO_PAUSE_PHRASES.resumed)
  }

  function feed(input: AutoPauseInput) {
    const autoPaused = status.value === 'paused' && pauseKind.value === 'auto'
    if (!enabled.value || (status.value !== 'running' && !autoPaused)) return
    const result = nextAutoPause(state, input)
    if (input.kind === 'fix') {
      console.info(describeFix(state, input.point, input.at, result.state, result.event))
    }
    state = result.state
    if (result.event?.kind === 'stop') {
      ownChange = true
      run.autoPause()
      say('stopped')
    } else if (result.event?.kind === 'resume') {
      ownChange = true
      run.autoResume(result.event.fromTimestamp)
      void sayResumed()
    }
  }

  function onFix(point: TrackPoint) {
    run.addPoint(point)
    feed({ kind: 'fix', at: Date.now(), point })
  }

  // Any change the detector did not make (Start, Pause, Resume, Stop, a recovered run): it
  // starts over, unarmed, so it never auto-pauses right after a manual Resume and never resumes
  // a manual pause
  watch([status, pauseKind], () => {
    if (ownChange) {
      ownChange = false
      return
    }
    stopWaiting()
    state = initAutoPauseState()
  })

  // Switched off while auto-paused: it stays paused, as a manual pause
  watch(enabled, (on) => {
    if (on) return
    run.holdPause()
    stopWaiting()
    state = initAutoPauseState()
  })

  onBeforeUnmount(stopWaiting)

  return { onFix }
}
