import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { TrackPoint } from '@/lib/geo'
import { paceSecPerKm, step, windowPaceSecPerKm } from '@/lib/runStats'

export type RunStatus = 'idle' | 'running' | 'paused' | 'finished'

/** Window used for the "current pace" figure */
const CURRENT_PACE_WINDOW_MS = 20_000
const MIN_CURRENT_PACE_DISTANCE_M = 5

export const useRunStore = defineStore('run', () => {
  const status = ref<RunStatus>('idle')
  // Raw fixes per running segment (start/resume to pause), inaccurate ones included
  const segments = ref<TrackPoint[][]>([])
  const points = computed(() => segments.value.flat())
  // Fixes of the current segment that passed the filters; feeds the current pace
  const segmentAccepted = ref<TrackPoint[]>([])
  const distanceM = ref(0)
  const movingMs = ref(0)

  // Elapsed time excludes pauses: banked time from finished segments + the live segment
  const bankedMs = ref(0)
  const segmentStart = ref<number | null>(null)
  const now = ref(Date.now())

  let timer: ReturnType<typeof setInterval> | null = null

  const elapsedMs = computed(() =>
    segmentStart.value === null
      ? bankedMs.value
      : bankedMs.value + (now.value - segmentStart.value),
  )

  const averagePaceSecPerKm = computed(() => paceSecPerKm(elapsedMs.value, distanceM.value))
  const averageMovingPaceSecPerKm = computed(() => paceSecPerKm(movingMs.value, distanceM.value))

  const currentPaceSecPerKm = computed(() => {
    if (status.value !== 'running' || segmentStart.value === null) return null
    // Never reach back before the last resume: the pause gap is not running
    const since = Math.max(now.value - CURRENT_PACE_WINDOW_MS, segmentStart.value)
    return windowPaceSecPerKm(segmentAccepted.value, since, MIN_CURRENT_PACE_DISTANCE_M)
  })

  function tick(t: number = Date.now()) {
    now.value = t
  }

  function startTimer() {
    stopTimer()
    timer = setInterval(() => tick(), 1000)
  }

  function stopTimer() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function start(t: number = Date.now()) {
    if (status.value !== 'idle') return
    reset()
    status.value = 'running'
    segmentStart.value = t
    segments.value.push([])
    tick(t)
    startTimer()
  }

  function pause(t: number = Date.now()) {
    if (status.value !== 'running' || segmentStart.value === null) return
    bankedMs.value += t - segmentStart.value
    segmentStart.value = null
    segmentAccepted.value = []
    status.value = 'paused'
    tick(t)
    stopTimer()
  }

  function resume(t: number = Date.now()) {
    if (status.value !== 'paused') return
    segmentStart.value = t
    segments.value.push([])
    status.value = 'running'
    tick(t)
    startTimer()
  }

  function stop(t: number = Date.now()) {
    if (status.value === 'running') pause(t)
    if (status.value !== 'paused') return
    status.value = 'finished'
  }

  /** Clear the finished run and return to the start screen. */
  function reset() {
    stopTimer()
    status.value = 'idle'
    segments.value = []
    segmentAccepted.value = []
    distanceM.value = 0
    movingMs.value = 0
    bankedMs.value = 0
    segmentStart.value = null
  }

  /** Feed a GPS fix. Ignored unless a run is in progress; kept even when filtered out. */
  function addPoint(point: TrackPoint) {
    if (status.value !== 'running') return
    segments.value[segments.value.length - 1]!.push(point)
    const anchor = segmentAccepted.value[segmentAccepted.value.length - 1] ?? null
    const result = step(anchor, point)
    if (!result.accepted) return
    distanceM.value += result.meters
    movingMs.value += result.movingMs
    segmentAccepted.value.push(point)
  }

  return {
    status,
    segments,
    points,
    distanceM,
    elapsedMs,
    movingMs,
    averagePaceSecPerKm,
    averageMovingPaceSecPerKm,
    currentPaceSecPerKm,
    start,
    pause,
    resume,
    stop,
    reset,
    addPoint,
    tick,
  }
})
