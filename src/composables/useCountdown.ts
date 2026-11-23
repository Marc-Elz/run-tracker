import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useKeepAwake } from '@/composables/useKeepAwake'
import { vibrateStepChange } from '@/lib/haptics'
import { keepWebViewAlive, timerService } from '@/lib/runPower'
import { speak } from '@/lib/speech'
import { buildTimeline, phaseCue, timerState, type TimerPreset } from '@/lib/timer'

export type CountdownStatus = 'idle' | 'running' | 'paused' | 'done'

/** Often enough that the shown second never lags visibly behind the clock */
const TICK_MS = 250

/**
 * The exercise timer (#124). Time comes from the clock, not from counting ticks: when Android
 * holds the page back, the next tick catches up instead of drifting. Each phase start is spoken
 * and buzzed once; phases that passed while the page was held back are skipped, only the
 * current one is cued. While running the screen stays on, and a foreground service plus the
 * page keep-alive keep the cues coming when the phone is locked.
 */
export function useCountdown(clock: () => number = () => Date.now()) {
  const preset = ref<TimerPreset | null>(null)
  const status = ref<CountdownStatus>('idle')
  // Time banked by finished stretches (before a pause) + the live stretch since `startedAt`
  const bankedMs = ref(0)
  const startedAt = ref<number | null>(null)
  const now = ref(clock())
  let timer: ReturnType<typeof setInterval> | null = null
  // The phase index last cued, so a phase is announced once
  let cued = -1

  const timeline = computed(() => (preset.value ? buildTimeline(preset.value) : []))
  const elapsedMs = computed(
    () =>
      bankedMs.value +
      (status.value === 'running' && startedAt.value !== null
        ? Math.max(0, now.value - startedAt.value)
        : 0),
  )
  const state = computed(() => timerState(timeline.value, elapsedMs.value))
  const phase = computed(() => timeline.value[state.value.index] ?? null)
  const next = computed(() => timeline.value[state.value.index + 1] ?? null)

  function cue(index: number) {
    cued = index
    void speak(phaseCue(timeline.value, index, preset.value?.rounds ?? 1))
    void vibrateStepChange()
  }

  function startTicking() {
    stopTicking()
    timer = setInterval(() => tick(), TICK_MS)
  }

  function stopTicking() {
    if (timer !== null) clearInterval(timer)
    timer = null
  }

  /** Move the clock on; cues the phase that started, or finishes the set */
  function tick(t: number = clock()) {
    if (status.value !== 'running') return
    now.value = t
    const s = state.value
    if (s.done) {
      bankedMs.value = elapsedMs.value
      startedAt.value = null
      status.value = 'done'
      stopTicking()
      cue(s.index)
    } else if (s.index !== cued) {
      cue(s.index)
    }
  }

  function start(p: TimerPreset, t: number = clock()) {
    preset.value = p
    bankedMs.value = 0
    startedAt.value = t
    now.value = t
    status.value = 'running'
    cue(0)
    startTicking()
  }

  function pause(t: number = clock()) {
    if (status.value !== 'running') return
    tick(t)
    if (status.value !== 'running') return
    bankedMs.value = elapsedMs.value
    startedAt.value = null
    status.value = 'paused'
    stopTicking()
  }

  function resume(t: number = clock()) {
    if (status.value !== 'paused') return
    startedAt.value = t
    now.value = t
    status.value = 'running'
    startTicking()
  }

  /** Back to the preset list; nothing is kept */
  function stop() {
    stopTicking()
    status.value = 'idle'
    preset.value = null
    bankedMs.value = 0
    startedAt.value = null
    cued = -1
  }

  const running = computed(() => status.value === 'running')
  useKeepAwake(running)
  function stayAlive(on: boolean) {
    void timerService(on)
    void keepWebViewAlive(on)
  }
  watch(running, stayAlive)
  onBeforeUnmount(() => {
    stopTicking()
    if (running.value) stayAlive(false)
  })

  return {
    preset,
    status,
    timeline,
    state,
    phase,
    next,
    elapsedMs,
    start,
    pause,
    resume,
    stop,
    tick,
  }
}
