import { computed, nextTick, onBeforeUnmount, watch, type Ref } from 'vue'
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
import type { MotionReading } from '@/lib/runPower'
import { isSpeaking, speak } from '@/lib/speech'

/** How often a held-back line checks whether other speech is over */
const WAIT_POLL_MS = 250

/** Starts motion readings (the phone's, or the simulator's); returns the function that stops them */
export type MotionSource = (onReading: (reading: MotionReading) => void) => () => void

/**
 * Auto-pause (#154) on the run screen. Returns `onFix`, the one GPS callback: it stores the fix
 * (`run.addPoint`) first, so the fix that shows a stop is still in the running segment, then
 * feeds the detector. Works while the run is running or auto-paused and the setting is on.
 * `motion` gives the phone's motion level while a run is on and the setting is on; without
 * readings the detector goes by GPS alone.
 *
 * `speak()` cuts off the line playing, so "Stop detected" waits for other speech to end, and
 * "Resumed" is left out when a step announcement comes with the resume (elapsed time jumps on
 * by the seconds it took to confirm, so a timed step can end right then).
 */
export function useAutoPause(enabled: Ref<boolean>, motion: MotionSource = () => () => {}) {
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
    } else if (result.event) {
      // A still phone can stop the run between fixes: log that decision too
      const from = state.paused ? 'paused' : 'running'
      console.info(`[autopause] ${from} motion=${input.level.toFixed(2)} -> ${result.event.kind}`)
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

  function onMotion(reading: MotionReading) {
    // Each reading is logged natively ([motion]); a decision it makes is logged in feed()
    // Timed on arrival, like the fixes: the hold times run on one clock
    if (reading.level !== undefined) feed({ kind: 'motion', at: Date.now(), level: reading.level })
  }

  // Motion readings while auto-pause is on and could act: running or auto-paused (not during a
  // manual pause, where feed() ignores them)
  let stopMotion: (() => void) | null = null
  const watching = computed(
    () =>
      enabled.value &&
      (status.value === 'running' || (status.value === 'paused' && pauseKind.value === 'auto')),
  )
  watch(
    watching,
    (on) => {
      if (on && !stopMotion) stopMotion = motion(onMotion)
      if (!on && stopMotion) {
        stopMotion()
        stopMotion = null
      }
    },
    { immediate: true },
  )

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

  onBeforeUnmount(() => {
    stopWaiting()
    stopMotion?.()
    stopMotion = null
  })

  return { onFix }
}
