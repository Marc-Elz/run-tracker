import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { TrackPoint } from '@/lib/geo'
import { paceSecPerKm, step, summarizeTrack, windowPaceSecPerKm } from '@/lib/runStats'
import { toSegments } from '@/lib/runSummary'
import { loadRouteOverviews } from '@/lib/routeOverview'
import { MAX_RUN_NAME_LENGTH } from '@/lib/format'
import { applyChange, closeOpenStep, type RunStep, type StepChange } from '@/lib/stepProgress'
import type { RunRecord, RunRepository, StoredPoint } from '@/lib/db/runRepository'
import { closePause, type PauseKind, type RunPause } from '@/lib/runPauses'
import { createMemoryRunRepository } from '@/lib/db/memoryRunRepository'

export type RunStatus = 'idle' | 'running' | 'paused' | 'finished'
/** Why a run is paused: the Pause button, or auto-pause (#154) waiting for the runner to move */
export type { PauseKind } from '@/lib/runPauses'

/** Window used for the "current pace" figure */
const CURRENT_PACE_WINDOW_MS = 20_000
const MIN_CURRENT_PACE_DISTANCE_M = 5
/** Fixes kept while auto-paused; a resume only needs the last few seconds */
const AUTO_PAUSE_BUFFER = 120

/** Running time of a saved run: banked time plus the open segment up to its last fix */
function savedElapsedMs(run: RunRecord, segments: TrackPoint[][]): number {
  if (run.segmentStartedAt === null) return run.elapsedMs
  const open = segments[run.segment] ?? []
  const lastFix = open[open.length - 1]
  return run.elapsedMs + (lastFix ? Math.max(0, lastFix.timestamp - run.segmentStartedAt) : 0)
}

export const useRunStore = defineStore('run', () => {
  const status = ref<RunStatus>('idle')
  // Set while paused; an auto-pause resumes by itself, a manual one never does
  const pauseKind = ref<PauseKind | null>(null)
  // The run's stored pauses (#154): auto-pauses, the last one open while auto-paused
  const runPauses = ref<RunPause[]>([])
  const runId = ref<string | null>(null)
  const startedAt = ref<number | null>(null)
  const finishedAt = ref<number | null>(null)
  // The training session this run was started from (#40), as stored; null for a free run
  const sessionId = ref<string | null>(null)
  // The session's steps as run so far (#101); empty for a free run
  const runSteps = ref<RunStep[]>([])
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
  // While auto-paused: when it paused, and the fixes since, not stored until the run moves on
  let pausedAt: number | null = null
  let autoBuffer: TrackPoint[] = []

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
      // Set by renameRun after the run is saved; never written back by updateRun
      name: null,
      status:
        status.value === 'finished' ? 'finished' : status.value === 'paused' ? 'paused' : 'running',
      startedAt: startedAt.value!,
      finishedAt: finishedAt.value,
      elapsedMs: bankedMs.value,
      segment: segments.value.length - 1,
      segmentStartedAt: segmentStart.value,
      movingMs: movingMs.value,
      distanceM: distanceM.value,
      sessionId: sessionId.value,
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

  /** A step ended or started (#101): kept here and written like a fix, so a failure shows "Not saving" */
  function applyStepChange(change: StepChange) {
    const id = runId.value
    if (id === null || (status.value !== 'running' && status.value !== 'paused')) return
    runSteps.value = applyChange(runSteps.value, change)
    persist((r) => r.saveStepChange(id, change.ended, change.started))
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

  /** Start a run, linked to a training session when one is given (#40) */
  function start(t: number = Date.now(), session: string | null = null) {
    if (status.value !== 'idle') return
    reset()
    status.value = 'running'
    runId.value = crypto.randomUUID()
    sessionId.value = session
    startedAt.value = t
    segmentStart.value = t
    segments.value.push([])
    tick(t)
    startTimer()
    const run = record()
    persist(async (r) => {
      const stored = await r.createRun(run)
      // The session may be gone or already run: then this is a free run after all
      if (runId.value === run.id) sessionId.value = stored
    })
  }

  function pause(t: number = Date.now()) {
    if (status.value !== 'running' || segmentStart.value === null) return
    bankedMs.value += t - segmentStart.value
    segmentStart.value = null
    segmentAccepted.value = []
    status.value = 'paused'
    pauseKind.value = 'manual'
    pausedAt = t
    tick(t)
    stopTimer()
    saveRun()
  }

  /** Store a pause row in the background, like a fix */
  function savePause(pause: RunPause) {
    const id = runId.value
    if (id === null) return
    runPauses.value = [...runPauses.value.filter((p) => p.position !== pause.position), pause]
    persist((r) => r.savePause(id, pause))
  }

  /** The open pause row, if any, ends at `t`: the run moved on, was held or stopped */
  function closeOpenPause(t: number) {
    const open = runPauses.value.find((p) => p.endedAt === null)
    if (open) savePause(closePause(open, t))
  }

  /**
   * Auto-pause (#154): paused like the Pause button, but resumes by itself (`autoResume`). A
   * pause row opens at the last accepted fix, for the run's history.
   */
  function autoPause(t: number = Date.now()) {
    if (status.value !== 'running') return
    const spot = segmentAccepted.value[segmentAccepted.value.length - 1] ?? null
    pause(t)
    pauseKind.value = 'auto'
    autoBuffer = []
    savePause({
      position: runPauses.value.length,
      kind: 'auto',
      startedAt: t,
      endedAt: null,
      startedElapsedMs: elapsedMs.value,
      lat: spot?.lat ?? null,
      lon: spot?.lon ?? null,
    })
  }

  /**
   * Pause tapped during an auto-pause (or auto-pause switched off): it becomes a manual pause and
   * never resumes by itself. The auto-pause row ends here; manual pauses are not stored.
   */
  function holdPause(t: number = Date.now()) {
    if (status.value !== 'paused' || pauseKind.value !== 'auto') return
    pauseKind.value = 'manual'
    autoBuffer = []
    closeOpenPause(t)
  }

  /**
   * The runner moved on after an auto-pause. `fromTimestamp` is the GPS time of the first moving
   * fix: the new segment starts there, and the fixes since are stored and counted, so the metres
   * covered while the resume was being confirmed are kept. Fixes before it (drift while
   * standing) are dropped. The GPS clock can differ from the phone's, so the start is kept
   * between the pause and now and elapsed time never goes backwards.
   */
  function autoResume(fromTimestamp: number, t: number = Date.now()) {
    if (status.value !== 'paused' || pauseKind.value !== 'auto') return
    const moved = autoBuffer.filter((p) => p.timestamp >= fromTimestamp)
    const start = Math.min(Math.max(fromTimestamp, pausedAt ?? t), t)
    resume(start)
    for (const p of moved) addPoint(p)
    tick(t)
  }

  function resume(t: number = Date.now()) {
    if (status.value !== 'paused') return
    // An auto-pause ends where the new segment starts (manual Resume, or `autoResume`)
    closeOpenPause(t)
    pauseKind.value = null
    pausedAt = null
    autoBuffer = []
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
    closeOpenPause(t)
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
    // The open step ends where the run ended, so a finished run has no open step (#67, #102)
    const closing = closeOpenStep(runSteps.value, {
      elapsedMs: elapsedMs.value,
      distanceM: distanceM.value,
    })
    try {
      if (closing) {
        await repo.saveStepChange(id, closing, [])
        runSteps.value = applyChange(runSteps.value, { ended: closing, started: [] })
      }
      await repo.updateRun(record())
    } catch (err) {
      console.warn('[db] write failed', err)
      saveError.value = true
      status.value = 'paused'
      pauseKind.value = 'manual'
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
  /** Finished runs with their route for the all-routes map; builds missing overviews first. */
  const loadOverviews = (onProgress?: (done: number, total: number) => void) =>
    loadRouteOverviews(repo, onProgress)
  const importRun = (
    run: RunRecord,
    points: StoredPoint[],
    steps: RunStep[] = [],
    pauses: RunPause[] = [],
  ) => repo.importRun(run, points, steps, pauses)
  const loadRunSteps = (id: string) => repo.loadRunSteps(id)
  const loadPauses = (id: string) => repo.loadPauses(id)
  const doneSessionIds = () => repo.doneSessionIds()
  /** Link a saved run to a session, or unlink it with null; resolves with the link as stored */
  const linkRun = (id: string, session: string | null) => repo.setRunSession(id, session)

  /** Name a saved run; blank clears the name. Resolves with the name as stored. */
  async function renameRun(id: string, name: string): Promise<string | null> {
    const stored = name.trim().slice(0, MAX_RUN_NAME_LENGTH) || null
    await repo.renameRun(id, stored)
    return stored
  }

  /** Clear the finished run and return to the start screen. */
  function reset() {
    stopTimer()
    status.value = 'idle'
    pauseKind.value = null
    pausedAt = null
    autoBuffer = []
    runId.value = null
    sessionId.value = null
    runSteps.value = []
    runPauses.value = []
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
  /**
   * An auto-pause left open when the app was killed ends at the last stored fix: the fixes held
   * back while auto-paused were never stored, so a later end is unknown. Never before it started.
   */
  async function closeKilledPauses(id: string, lastFix: TrackPoint | undefined) {
    const stored = await repo.loadPauses(id)
    const closed: RunPause[] = []
    for (const p of stored) {
      if (p.endedAt !== null) {
        closed.push(p)
        continue
      }
      const ended = closePause(p, lastFix?.timestamp ?? p.startedAt)
      await repo.savePause(id, ended)
      closed.push(ended)
    }
    return closed
  }

  async function recover() {
    if (status.value !== 'idle') return
    const [latest, ...older] = await repo.findUnfinished()
    for (const run of older) {
      const restored = toSegments(await repo.loadPoints(run.id), run.segment)
      const all = restored.flat()
      const lastFix = all[all.length - 1]
      const totals = summarizeTrack(restored)
      const elapsed = savedElapsedMs(run, restored)
      const open = closeOpenStep(await repo.loadRunSteps(run.id), {
        elapsedMs: elapsed,
        distanceM: totals.distanceM,
      })
      if (open) await repo.saveStepChange(run.id, open, [])
      await closeKilledPauses(run.id, lastFix)
      await repo.updateRun({
        ...run,
        ...totals,
        status: 'finished',
        elapsedMs: elapsed,
        segmentStartedAt: null,
        finishedAt: lastFix?.timestamp ?? run.segmentStartedAt ?? run.startedAt,
      })
    }
    if (!latest) return

    const restored = toSegments(await repo.loadPoints(latest.id), latest.segment)
    const totals = summarizeTrack(restored)
    const steps = await repo.loadRunSteps(latest.id)
    const latestFixes = restored.flat()
    runPauses.value = await closeKilledPauses(latest.id, latestFixes[latestFixes.length - 1])
    runId.value = latest.id
    sessionId.value = latest.sessionId
    runSteps.value = steps
    startedAt.value = latest.startedAt
    segments.value = restored
    segmentAccepted.value = []
    distanceM.value = totals.distanceM
    movingMs.value = totals.movingMs
    bankedMs.value = savedElapsedMs(latest, restored)
    segmentStart.value = null
    status.value = 'paused'
    pauseKind.value = 'manual'
    recovered.value = true
    tick()
    saveRun()
    console.info('[db] recovered run', latest.id, restored.flat().length, 'points')
  }

  /**
   * Feed a GPS fix. Ignored unless a run is in progress; kept even when filtered out. While
   * auto-paused it is held back, for `autoResume` to store if it is part of moving on.
   */
  function addPoint(point: TrackPoint) {
    if (status.value === 'paused' && pauseKind.value === 'auto') {
      autoBuffer = [...autoBuffer.slice(1 - AUTO_PAUSE_BUFFER), point]
      return
    }
    if (status.value !== 'running') return
    segments.value[segments.value.length - 1]!.push(point)
    const id = runId.value!
    const segment = segments.value.length - 1
    persist((r) => r.addPoint(id, segment, point))
    const anchor = segmentAccepted.value[segmentAccepted.value.length - 1] ?? null
    const result = step(anchor, point)
    if (!result.accepted) return
    // Bring the clock up to now, so new distance and the time it was covered in arrive together:
    // the pace coach (#103) measures pace between these moments, and a whole-second clock would
    // make a steady pace swing by half a minute per km
    tick()
    distanceM.value += result.meters
    movingMs.value += result.movingMs
    segmentAccepted.value.push(point)
  }

  return {
    status,
    pauseKind,
    runId,
    sessionId,
    runSteps,
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
    autoPause,
    holdPause,
    autoResume,
    resume,
    stop,
    finish,
    getRun,
    listFinished,
    loadPoints,
    loadOverviews,
    deleteRun,
    importRun,
    loadRunSteps,
    loadPauses,
    runPauses,
    applyStepChange,
    doneSessionIds,
    linkRun,
    renameRun,
    reset,
    discard,
    recover,
    useRepository,
    addPoint,
    tick,
  }
})
