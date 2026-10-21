import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { distanceMeters, type TrackPoint } from '@/lib/geo'

export type RunStatus = 'idle' | 'running' | 'paused' | 'finished'

/** Window used for the "current pace" figure */
const CURRENT_PACE_WINDOW_MS = 20_000
/** Below this distance a pace is meaningless (GPS jitter while standing still) */
const MIN_PACE_DISTANCE_M = 10
const MIN_CURRENT_PACE_DISTANCE_M = 5

export const useRunStore = defineStore('run', () => {
  const status = ref<RunStatus>('idle')
  const points = ref<TrackPoint[]>([])
  const distanceM = ref(0)

  // Elapsed time excludes pauses: banked time from finished segments + the live segment
  const bankedMs = ref(0)
  const segmentStart = ref<number | null>(null)
  const now = ref(Date.now())

  // Last point of the current segment; reset on pause so the gap isn't counted as distance
  let lastPoint: TrackPoint | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  const elapsedMs = computed(() =>
    segmentStart.value === null
      ? bankedMs.value
      : bankedMs.value + (now.value - segmentStart.value),
  )

  const averagePaceSecPerKm = computed(() =>
    distanceM.value < MIN_PACE_DISTANCE_M
      ? null
      : elapsedMs.value / 1000 / (distanceM.value / 1000),
  )

  const currentPaceSecPerKm = computed(() => {
    if (status.value !== 'running' || segmentStart.value === null) return null
    // Never reach back before the last resume: the pause gap is not running
    const cutoff = Math.max(now.value - CURRENT_PACE_WINDOW_MS, segmentStart.value)
    const recent = points.value.filter((p) => p.timestamp >= cutoff)
    const first = recent[0]
    const last = recent[recent.length - 1]
    if (!first || !last || first === last) return null
    let meters = 0
    for (let i = 1; i < recent.length; i++) {
      const prev = recent[i - 1]!
      const cur = recent[i]!
      meters += distanceMeters(prev, cur)
    }
    const seconds = (last.timestamp - first.timestamp) / 1000
    if (meters < MIN_CURRENT_PACE_DISTANCE_M || seconds <= 0) return null
    return seconds / (meters / 1000)
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
    tick(t)
    startTimer()
  }

  function pause(t: number = Date.now()) {
    if (status.value !== 'running' || segmentStart.value === null) return
    bankedMs.value += t - segmentStart.value
    segmentStart.value = null
    lastPoint = null
    status.value = 'paused'
    tick(t)
    stopTimer()
  }

  function resume(t: number = Date.now()) {
    if (status.value !== 'paused') return
    segmentStart.value = t
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
    points.value = []
    distanceM.value = 0
    bankedMs.value = 0
    segmentStart.value = null
    lastPoint = null
  }

  /** Feed a GPS fix. Ignored unless a run is in progress. */
  function addPoint(point: TrackPoint) {
    if (status.value !== 'running') return
    if (lastPoint) distanceM.value += distanceMeters(lastPoint, point)
    lastPoint = point
    points.value.push(point)
  }

  return {
    status,
    points,
    distanceM,
    elapsedMs,
    averagePaceSecPerKm,
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
