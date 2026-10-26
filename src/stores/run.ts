import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { TrackPoint } from '@/lib/geo'
import { paceSecPerKm, step, summarizeTrack, windowPaceSecPerKm } from '@/lib/runStats'
import { toSegments } from '@/lib/runSummary'
import type { RunRecord, RunRepository } from '@/lib/db/runRepository'
import { createMemoryRunRepository } from '@/lib/db/memoryRunRepository'

export type RunStatus = 'idle' | 'running' | 'paused' | 'finished'

/** Window used for the "current pace" figure */
const CURRENT_PACE_WINDOW_MS = 20_000
const MIN_CURRENT_PACE_DISTANCE_M = 5

/** Running time of a saved run: banked time plus the open segment up to its last fix */
function savedElapsedMs(run: RunRecord, segments: TrackPoint[][]): number {
  if (run.segmentStartedAt === null) return run.elapsedMs
  const open = segments[run.segment] ?? []
  const lastFix = open[open.length - 1]
  return run.elapsedMs + (lastFix ? Math.max(0, lastFix.timestamp - run.segmentStartedAt) : 0)
}

export const useRunStore = defineStore('run', () => {
  const status = ref<RunStatus>('idle')
  const runId = ref<string | null>(null)
  const startedAt = ref<number | null>(null)
  const finishedAt = ref<number | null>(null)
  // Brought back after the app was killed mid-run; cleared on resume
  const recovered = ref(false)
  // A write to the database failed: the run goes on, but may not survive the app closing
  const saveError = ref(false)
  // Raw fixes per running segment (start/resume to pause), inaccurate ones included
  const segments = ref<TrackPoint[][]>([])
  const points = computed(() => segments.value.flat())
  // Fixes of the current segment that passed the filters; feeds the current pace
  const segmentAccepted = ref<TrackPoint[]>([])
  // False until the current segment has a usable fix: the screen shows "Acquiring GPS"
  const hasFix = computed(() => segmentAccepted.value.length > 0)
  const distanceM = ref(0)
  const movingMs = ref(0)

  // Elapsed time excludes pauses: banked time from finished segments + the live segment
  const bankedMs = ref(0)
  const segmentStart = ref<number | null>(null)
  const now = ref(Date.now())

  let timer: ReturnType<typeof setInterval> | null = null
  let repo: RunRepository = createMemoryRunRepository()

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

  function useRepository(r: RunRepository) {
    repo = r
  }

  function record(): RunRecord {
    return {
      id: runId.value!,
      status:
        status.value === 'finished' ? 'finished' : status.value === 'paused' ? 'paused' : 'running',
      startedAt: startedAt.value!,
      finishedAt: finishedAt.value,
      elapsedMs: bankedMs.value,
      segment: segments.value.length - 1,
      segmentStartedAt: segmentStart.value,
      movingMs: movingMs.value,
      distanceM: distanceM.value,
    }
  }

  /** Write in the background; a failure is logged and flagged, the run carries on. */
  function persist(write: (r: RunRepository) => Promise<void>) {
    write(repo).catch((err: unknown) => {
      console.warn('[db] write failed', err)
      saveError.value = true
    })
  }

  function saveRun() {
    if (runId.value !== null) persist((r) => r.updateRun(record()))
  }

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
    runId.value = crypto.randomUUID()
    startedAt.value = t
    segmentStart.value = t
    segments.value.push([])
    tick(t)
    startTimer()
    const run = record()
    persist((r) => r.createRun(run))
  }

  function pause(t: number = Date.now()) {
    if (status.value !== 'running' || segmentStart.value === null) return
    bankedMs.value += t - segmentStart.value
    segmentStart.value = null
    segmentAccepted.value = []
    status.value = 'paused'
    tick(t)
    stopTimer()
    saveRun()
  }

  function resume(t: number = Date.now()) {
    if (status.value !== 'paused') return
    segmentStart.value = t
    segments.value.push([])
    // Never measure the first fix from a point before the pause (or before the app was killed)
    segmentAccepted.value = []
    recovered.value = false
    status.value = 'running'
    tick(t)
    startTimer()
    saveRun()
  }

  function stop(t: number = Date.now()) {
    if (status.value === 'running') pause(t)
    if (status.value !== 'paused') return
    status.value = 'finished'
    finishedAt.value = t
    saveRun()
  }

  /**
   * Stop the run and save it, then clear the store. Resolves with the run id to open, or null when
   * the save failed: the run goes back to paused, so Stop can be tried again and nothing is lost.
   */
  async function finish(t: number = Date.now()): Promise<string | null> {
    stop(t)
    if (status.value !== 'finished') return null
    const id = runId.value!
    try {
      await repo.updateRun(record())
    } catch (err) {
      console.warn('[db] write failed', err)
      saveError.value = true
      status.value = 'paused'
      finishedAt.value = null
      return null
    }
    reset()
    return id
  }

  /** Saved runs, for the summary and History screens. */
  const getRun = (id: string) => repo.getRun(id)
  const listFinished = () => repo.listFinished()
  const loadPoints = (id: string) => repo.loadPoints(id)
  const deleteRun = (id: string) => repo.deleteRun(id)

  /** Clear the finished run and return to the start screen. */
  function reset() {
    stopTimer()
    status.value = 'idle'
    runId.value = null
    startedAt.value = null
    finishedAt.value = null
    recovered.value = false
    saveError.value = false
    segments.value = []
    segmentAccepted.value = []
    distanceM.value = 0
    movingMs.value = 0
    bankedMs.value = 0
    segmentStart.value = null
  }

  /** Delete the run and its points, then return to the start screen. */
  function discard() {
    const id = runId.value
    reset()
    if (id !== null) persist((r) => r.deleteRun(id))
  }

  /**
   * Bring back a run the app was killed in, paused, with totals recomputed from its raw points.
   * Older unfinished runs (repeated crashes) are saved as finished.
   */
  async function recover() {
    if (status.value !== 'idle') return
    const [latest, ...older] = await repo.findUnfinished()
    for (const run of older) {
      const restored = toSegments(await repo.loadPoints(run.id), run.segment)
      const all = restored.flat()
      const lastFix = all[all.length - 1]
      await repo.updateRun({
        ...run,
        ...summarizeTrack(restored),
        status: 'finished',
        elapsedMs: savedElapsedMs(run, restored),
        segmentStartedAt: null,
        finishedAt: lastFix?.timestamp ?? run.segmentStartedAt ?? run.startedAt,
      })
    }
    if (!latest) return

    const restored = toSegments(await repo.loadPoints(latest.id), latest.segment)
    const totals = summarizeTrack(restored)
    runId.value = latest.id
    startedAt.value = latest.startedAt
    segments.value = restored
    segmentAccepted.value = []
    distanceM.value = totals.distanceM
    movingMs.value = totals.movingMs
    bankedMs.value = savedElapsedMs(latest, restored)
    segmentStart.value = null
    status.value = 'paused'
    recovered.value = true
    tick()
    saveRun()
    console.info('[db] recovered run', latest.id, restored.flat().length, 'points')
  }

  /** Feed a GPS fix. Ignored unless a run is in progress; kept even when filtered out. */
  function addPoint(point: TrackPoint) {
    if (status.value !== 'running') return
    segments.value[segments.value.length - 1]!.push(point)
    const id = runId.value!
    const segment = segments.value.length - 1
    persist((r) => r.addPoint(id, segment, point))
    const anchor = segmentAccepted.value[segmentAccepted.value.length - 1] ?? null
    const result = step(anchor, point)
    if (!result.accepted) return
    distanceM.value += result.meters
    movingMs.value += result.movingMs
    segmentAccepted.value.push(point)
  }

  return {
    status,
    runId,
    startedAt,
    recovered,
    saveError,
    segments,
    points,
    hasFix,
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
    finish,
    getRun,
    listFinished,
    loadPoints,
    deleteRun,
    reset,
    discard,
    recover,
    useRepository,
    addPoint,
    tick,
  }
})
