<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { useRunStore } from '@/stores/run'
import { useTrainingStore } from '@/stores/training'
import { useKeepAwake } from '@/composables/useKeepAwake'
import { useAudioCues } from '@/composables/useAudioCues'
import { usePlannedSession } from '@/composables/usePlannedSession'
import { useSessionSteps } from '@/composables/useSessionSteps'
import { useStepCues } from '@/composables/useStepCues'
import { usePaceCoach } from '@/composables/usePaceCoach'
import { useAutoPause } from '@/composables/useAutoPause'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import SessionPicker from '@/components/SessionPicker.vue'
import { autoPause, cueConfig, slowestRunPace, slowestWalk, stepCoaching } from '@/lib/settings'
import { effectiveWalkFloor, type WalkSuggestion } from '@/lib/walkPace'
import { GpsError, openAppSettings, startGps, usesSimulatedGps, type GpsFailure } from '@/lib/gps'
import { simulatedStandStill, watchSimulatedMotion } from '@/lib/simulateGps'
import {
  ensureBatteryExemption,
  ensureNotifications,
  keepWebViewAlive,
  watchMotion,
} from '@/lib/runPower'
import { formatDistanceKm, formatDuration, formatMetres, formatPace } from '@/lib/format'
import {
  SESSION_TYPE_LABELS,
  STEP_KIND_LABELS,
  formatMinSec,
  sessionTitle,
  type ProgramSession,
} from '@/lib/training'
import { nextStepLabel, stepKindLabel } from '@/lib/stepProgress'

const run = useRunStore()
const training = useTrainingStore()
const router = useRouter()
const route = useRoute()
const {
  status,
  pauseKind,
  runId,
  sessionId,
  hasFix,
  recovered,
  saveError,
  distanceM,
  elapsedMs,
  averagePaceSecPerKm,
  currentPaceSecPerKm,
} = storeToRefs(run)

// The session to offer: one picked with "Run this session" (?session=), else the next one
const requested = computed(() =>
  typeof route.query.session === 'string' ? route.query.session : null,
)
const { planned, following, reload: reloadPlanned } = usePlannedSession(requested)
const nextUp = computed(() => planned.value?.session ?? null)

// ⇄ on the card (#148): pick another session. `replace`, so Back leaves the Run screen instead of
// stepping through earlier picks; the followed program's next session means "no pick".
const pickingSession = ref(false)
function onPickSession(id: string, isNext: boolean) {
  pickingSession.value = false
  void router.replace(isNext ? { name: 'run' } : { name: 'run', query: { session: id } })
}

// The session the current run belongs to, for the line at the top (#101 builds on it)
const linked = ref<{ session: ProgramSession; title: string } | null>(null)
watch(
  sessionId,
  async (id) => {
    linked.value = null
    if (id === null) return
    try {
      const found = await training.getSession(id)
      // Without its steps the name falls back to the type (#143)
      const steps = found ? await training.loadSteps(id).catch(() => []) : []
      if (sessionId.value === id && found) {
        linked.value = { session: found, title: sessionTitle(found, steps) }
      }
    } catch (err) {
      console.warn('[db] could not load the session of this run', err)
    }
  },
  { immediate: true },
)

// The session's step, in large type, while a run of a session with steps is going (#101)
const { progress: steps, nextStep, timeline: stepTimeline } = useSessionSteps()
useStepCues(
  stepTimeline,
  computed(() => stepCoaching.value !== 'off'),
)
// The walk pace suggestion (#153), loaded once per session run, so a walk saved mid-run does not
// move the floor. A typed pace or a switch in Settings still applies at once.
const walkSuggestion = ref<WalkSuggestion | null>(null)
let walkSuggestionRun: string | null = null
watch(
  [runId, sessionId, () => stepCoaching.value === 'pace' && slowestWalk.value.on],
  async ([id, session, wanted]) => {
    if (id !== walkSuggestionRun) walkSuggestion.value = null
    if (id === null || session === null || !wanted || id === walkSuggestionRun) return
    walkSuggestionRun = id
    try {
      const found = await run.loadWalkSuggestion()
      if (runId.value === id) walkSuggestion.value = found
    } catch (err) {
      console.warn('[db] could not load recent walks', err)
    }
  },
  { immediate: true },
)
usePaceCoach(
  computed(() => stepCoaching.value === 'pace'),
  slowestRunPace,
  {
    floor: computed(() => effectiveWalkFloor(slowestWalk.value, walkSuggestion.value).floor),
    sessionType: computed(() => linked.value?.session.type ?? null),
    breaks: computed(() => slowestWalk.value.breaks),
  },
)
const isDev = import.meta.env.DEV
const simulate = ref(isDev)
// Fake GPS (dev, and the web demo): "Stand still" tries auto-pause in the browser (#154)
const simulating = computed(() => usesSimulatedGps(isDev && simulate.value))
const gpsFailure = ref<GpsFailure | null>(null)
// Pauses at a stop and carries on when moving again (#154); the one consumer of GPS fixes
// The phone's motion level helps tell standing from GPS drift; the simulator gives its own.
// Off while GPS has failed: a still phone would pause a run that could never resume
const autoPauseOn = computed(() => autoPause.value && gpsFailure.value === null)
const { onFix } = useAutoPause(autoPauseOn, (onReading) =>
  simulating.value ? watchSimulatedMotion(onReading) : watchMotion(onReading),
)
const autoPaused = computed(() => status.value === 'paused' && pauseKind.value === 'auto')
/** "Target 5:30–6:00 /km" on a step with a pace target */
const stepTarget = computed(() => {
  const step = steps.value?.current
  if (!step || (step.paceMin === null && step.paceMax === null)) return ''
  const fast = step.paceMin ?? step.paceMax
  const slow = step.paceMax ?? step.paceMin
  const range = fast === slow ? formatPace(fast) : `${formatPace(fast)}–${formatPace(slow)}`
  return `Target ${range} /km`
})
/** Time or metres left, or the time spent so far in a step without a target */
const stepValue = computed(() => {
  const p = steps.value
  if (!p) return ''
  // Rounded up, so a 1:00 step shows 1:00 at its start and 0:00 only once it is over
  if (p.leftMs !== null) return formatMinSec(Math.ceil(p.leftMs / 1000))
  if (p.leftM !== null) return formatMetres(Math.ceil(p.leftM))
  return formatMinSec(Math.floor(p.inStepMs / 1000))
})
const canSkip = computed(
  () => status.value === 'running' && steps.value?.current?.targetKind === 'none',
)
const confirmingNext = ref(false)
// A pause (or the run ending) closes the question: Next step is only for a running step
watch(canSkip, (on) => {
  if (!on) confirmingNext.value = false
})
function onNextStep() {
  nextStep()
  confirmingNext.value = false
}

useKeepAwake(computed(() => status.value === 'running' || status.value === 'paused'))
useAudioCues(cueConfig)

// Android freezes the page with the screen off; a run needs its timer, fixes and cues to go on
const runActive = computed(() => status.value === 'running' || status.value === 'paused')
watch(runActive, (on) => void keepWebViewAlive(on), { immediate: true })
onBeforeUnmount(() => void keepWebViewAlive(false))

const starting = ref(false)
const batteryHint = ref(false)
const stopping = ref(false)
let stopGps: (() => void) | null = null

function endGps() {
  stopGps?.()
  stopGps = null
}

function onGpsError(err: Error) {
  if (!(err instanceof GpsError)) return // transient; the run carries on
  endGps()
  gpsFailure.value = err.failure
  // Refused right at the start: delete the empty run, so it doesn't come back as recovered.
  // Mid-run: keep what was recorded.
  if (run.points.length === 0) run.discard()
}

/**
 * Ask for the permissions, move the run on (start or resume), then start GPS. The clock
 * starts on the tap; fixes come in once GPS has a signal ("Acquiring GPS").
 */
async function beginTracking(advance: () => void, undo: () => void) {
  starting.value = true
  gpsFailure.value = null
  try {
    await ensureNotifications()
    batteryHint.value = !(await ensureBatteryExemption())
    advance()
    stopGps = await startGps(onFix, onGpsError, { simulate: simulating.value })
  } catch (err) {
    console.warn('GPS could not start', err)
    undo()
  } finally {
    starting.value = false
  }
}

/** Start a free run, or a run of the given training session */
function onStart(session: string | null = null) {
  if (starting.value || status.value !== 'idle') return
  return beginTracking(
    () => run.start(Date.now(), session),
    () => run.discard(),
  )
}

function onResume() {
  if (starting.value || status.value !== 'paused') return
  // GPS stays on while paused, except after a recovered run: nothing started it yet
  if (stopGps) return run.resume()
  return beginTracking(
    () => run.resume(),
    () => (run.points.length === 0 ? run.discard() : run.pause()),
  )
}

/** Save the run, then open its summary; if saving fails the run stays here, paused, to try again. */
async function onStop() {
  if (stopping.value) return
  stopping.value = true
  try {
    const id = await run.finish()
    if (id !== null) await router.push({ name: 'run-summary', params: { id } })
  } finally {
    stopping.value = false
  }
}

// GPS stays on while paused (the store ignores those fixes) and stops with the run
watch(status, (s) => {
  if (s === 'finished' || s === 'idle') {
    endGps()
    simulatedStandStill.value = false
  }
  // Back on the start screen without leaving it (a discarded run): offer the session again
  if (s === 'idle') void reloadPlanned()
})
onBeforeUnmount(endGps)
</script>

<template>
  <main class="run" :data-status="status">
    <section v-if="status === 'idle' && planned" class="session-card" aria-label="Training session">
      <div class="session-card__info">
        <template v-if="nextUp">
          <p class="session-card__label">
            {{ planned.chosen ? 'Session' : 'Next session' }} · Week {{ nextUp.week }}
          </p>
          <p class="session-card__type">{{ SESSION_TYPE_LABELS[nextUp.type] }}</p>
          <p class="session-card__title">{{ planned.title }}</p>
          <p class="session-card__program">{{ planned.program.name }}</p>
        </template>
        <template v-else>
          <p class="session-card__title">{{ planned.program.name }}</p>
          <p class="session-card__program">All sessions done</p>
        </template>
      </div>
      <button
        class="session-card__switch"
        aria-label="Choose another session"
        :disabled="starting"
        @click="pickingSession = true"
      >
        <span aria-hidden="true">⇄</span>
      </button>
    </section>
    <SessionPicker
      v-if="pickingSession"
      title="Choose a session"
      :selected-id="nextUp?.id ?? null"
      @pick="onPickSession"
      @close="pickingSession = false"
    />

    <section
      v-if="steps"
      class="step-panel"
      :class="{ 'step-panel--done': steps.done }"
      aria-label="Session step"
    >
      <p class="step-panel__top">
        <span class="step-panel__kind">
          {{ steps.current ? stepKindLabel(steps.current) : 'Session done' }}
        </span>
        <span class="step-panel__count">{{ steps.index + 1 }} / {{ steps.count }}</span>
      </p>
      <template v-if="steps.done">
        <p class="step-panel__done">Session done</p>
        <p class="step-panel__hint">Recording until you tap Stop</p>
      </template>
      <template v-else>
        <span class="step-panel__value">{{ stepValue }}</span>
        <span class="stat__label">
          {{ steps.current?.targetKind === 'none' ? 'In this step' : 'Left' }}
        </span>
        <p v-if="stepTarget" class="step-panel__target">{{ stepTarget }}</p>
        <p v-if="steps.next" class="step-panel__next">Next: {{ nextStepLabel(steps.next) }}</p>
        <button
          v-if="canSkip"
          class="btn btn--primary step-panel__btn"
          @click="confirmingNext = true"
        >
          Next step
        </button>
      </template>
    </section>

    <p v-else-if="status !== 'idle' && linked" class="session-line">
      Week {{ linked.session.week }} · {{ linked.title }}
    </p>

    <p v-if="status === 'running' && !hasFix && !gpsFailure" class="gps-status">Acquiring GPS…</p>
    <p v-if="autoPaused" class="gps-status" role="status">Auto-paused · moves on when you do</p>

    <section class="stats" aria-live="off">
      <!-- With a step panel its number is the one big number; the totals step down a size -->
      <div :class="steps ? 'stat-row' : 'stats__totals'">
        <div class="stat stat--time">
          <span class="stat__value" :class="{ 'stat__value--small': steps }">
            {{ formatDuration(elapsedMs) }}
          </span>
          <span class="stat__label">Time</span>
        </div>
        <div class="stat stat--distance">
          <span class="stat__value" :class="{ 'stat__value--small': steps }">
            {{ formatDistanceKm(distanceM) }}
          </span>
          <span class="stat__label">Distance (km)</span>
        </div>
      </div>
      <div class="stat-row">
        <div class="stat">
          <span class="stat__value stat__value--small">{{ formatPace(currentPaceSecPerKm) }}</span>
          <span class="stat__label">Pace (min/km)</span>
        </div>
        <div class="stat">
          <span class="stat__value stat__value--small">{{ formatPace(averagePaceSecPerKm) }}</span>
          <span class="stat__label">Avg pace (min/km)</span>
        </div>
      </div>
    </section>

    <section v-if="gpsFailure" class="notice" role="alert">
      <template v-if="gpsFailure === 'denied'">
        <p>Location permission is needed to record a run.</p>
        <button class="btn btn--secondary" @click="openAppSettings()">Open settings</button>
      </template>
      <p v-else>Location is off. Turn it on in quick settings, then tap Start.</p>
    </section>

    <p v-if="recovered && status === 'paused'" class="notice">
      Run recovered after the app was closed. Resume to carry on, or Stop to save it.
    </p>

    <p v-if="saveError" class="notice notice--warn" role="alert">
      Not saving: this run may be lost if the app closes.
    </p>

    <p v-if="batteryHint" class="notice">
      Battery optimisation is on, so Android may stop the run. On Samsung: Settings › Battery ›
      Background usage limits › Never sleeping apps, add Run Tracker.
    </p>

    <p v-if="status === 'idle' && !following" class="hint">
      Follow a program in Training to run its sessions
    </p>

    <section class="controls" :class="{ 'controls--session': status === 'idle' && nextUp }">
      <template v-if="status === 'idle' && nextUp">
        <button class="btn btn--primary" :disabled="starting" @click="onStart(nextUp.id)">
          Start session
        </button>
        <button class="btn btn--secondary" :disabled="starting" @click="onStart()">Free run</button>
      </template>

      <button
        v-else-if="status === 'idle'"
        class="btn btn--primary"
        :disabled="starting"
        @click="onStart()"
      >
        Start
      </button>

      <button v-else-if="status === 'running'" class="btn btn--secondary" @click="run.pause()">
        Pause
      </button>

      <template v-else-if="status === 'paused'">
        <button v-if="autoPaused" class="btn btn--secondary btn--wide" @click="run.holdPause()">
          Pause
        </button>
        <button class="btn btn--primary" :disabled="starting" @click="onResume()">Resume</button>
        <button class="btn btn--danger" :disabled="stopping" @click="onStop()">Stop</button>
      </template>
    </section>

    <ConfirmDialog
      v-if="confirmingNext && steps?.current"
      :title="`End ${STEP_KIND_LABELS[steps.current.kind].toLowerCase()}?`"
      confirm-label="Next step"
      @keep="confirmingNext = false"
      @confirm="onNextStep"
    >
      <template v-if="steps.next">
        {{ nextStepLabel(steps.next) }} starts now. This can't be undone.
      </template>
      <template v-else>The session ends; the run keeps recording until you stop it.</template>
    </ConfirmDialog>

    <label v-if="status === 'idle' && isDev" class="dev">
      <input v-model="simulate" type="checkbox" /> Simulate GPS (dev only)
    </label>
    <label v-if="(status === 'running' || status === 'paused') && simulating" class="dev">
      <input v-model="simulatedStandStill" type="checkbox" /> Stand still (simulated GPS)
    </label>
  </main>
</template>

<style scoped>
.run {
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 1.5rem;
  padding: max(1.5rem, env(safe-area-inset-top)) 1.5rem max(1.5rem, env(safe-area-inset-bottom));
  background: #101418;
  color: #f4f6f8;
  font-family: system-ui, sans-serif;
}

.stats {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  text-align: center;
}

.stats__totals {
  display: flex;
  flex-direction: column;
  gap: inherit;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat__value {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1;
  font-size: clamp(3.5rem, 22vw, 6.5rem);
}

.stat__value--small {
  font-size: clamp(2rem, 11vw, 3.5rem);
}

.stat__label {
  margin-top: 0.4rem;
  font-size: 0.9rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #9aa5b1;
}

.stat-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.btn {
  flex: 1;
  min-height: 4.5rem;
  border: 0;
  border-radius: 1rem;
  font-size: 1.4rem;
  font-weight: 700;
  color: #fff;
}

/* Side by side, so both stay in view on a 360 px phone with the session card above */
.btn--wide {
  flex-basis: 100%;
}
.controls--session .btn--primary {
  flex: 3;
}

.controls--session .btn--secondary {
  flex: 2;
  font-size: 1.15rem;
}

.btn--primary {
  background: #1f9d55;
}

/* The training session on offer (#40): read at a glance, before the stats */
.session-card {
  display: flex;
  /* overflow: hidden (for the strip's rounded corners) would let the column squeeze the card */
  flex: none;
  overflow: hidden;
  border-radius: 1rem;
  background: #1a2027;
}

.session-card__info {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
  padding: 1rem 1.25rem;
}

/* ⇄ (#148): a full-height strip on the right edge, a big target behind a divider */
.session-card__switch {
  flex: none;
  width: 3.75rem;
  border: 0;
  border-left: 1px solid #2a323b;
  background: none;
  color: #f4f6f8;
  font-size: 1.6rem;
}

.session-card__switch:active {
  background: #26303a;
}

.session-card__switch:disabled {
  opacity: 0.6;
}

.session-card p {
  margin: 0;
}

.session-card__label {
  font-size: 0.85rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #9aa5b1;
}

.session-card__type,
.session-card__program {
  color: #9aa5b1;
}

.session-card__title {
  font-size: 1.4rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-line {
  margin: 0;
  text-align: center;
  color: #9aa5b1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hint {
  margin: 0;
  text-align: center;
  color: #9aa5b1;
}

.btn--secondary {
  background: #3b4652;
}

.btn--danger {
  background: #d64545;
}

.run[data-status='paused'] .stat__value,
.run[data-status='paused'] .step-panel {
  opacity: 0.6;
}

/* The current session step (#101): read at a glance, so its number is the big one */
.step-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1rem 1.25rem;
  border-radius: 1rem;
  background: #1a2027;
  text-align: center;
}

.step-panel p {
  margin: 0;
}

.step-panel__top {
  align-self: stretch;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.5rem !important;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.step-panel__kind {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.step-panel__count {
  flex: none;
  font-variant-numeric: tabular-nums;
  color: #9aa5b1;
}

.step-panel__value {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1;
  font-size: clamp(3.5rem, 22vw, 6.5rem);
}

.step-panel__target {
  margin-top: 0.35rem !important;
  font-size: 1.25rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #e8edf2;
}

.step-panel__next {
  align-self: stretch;
  margin-top: 0.75rem !important;
  text-align: left;
  font-size: 1.1rem;
  color: #c3ccd5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.step-panel__btn {
  align-self: stretch;
  flex: none;
  min-height: 3.5rem;
  margin-top: 0.75rem;
}

.step-panel__done {
  font-size: 2rem;
  font-weight: 700;
}

.step-panel__hint {
  color: #9aa5b1;
}

.gps-status {
  margin: 0;
  text-align: center;
  font-size: 1.2rem;
  font-weight: 700;
  color: #f5c451;
}

.notice {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 0;
  padding: 1rem;
  border-radius: 1rem;
  background: #2a2f36;
  font-size: 1rem;
  line-height: 1.4;
}

.notice--warn {
  background: #5c3a12;
  color: #ffe2b8;
}

.notice p {
  margin: 0;
}

/* Short screens (small phones, large font scale): tighten so the controls stay in view */
@media (max-height: 640px) {
  .run {
    gap: 1rem;
    padding-top: max(1rem, env(safe-area-inset-top));
    padding-bottom: max(1rem, env(safe-area-inset-bottom));
  }

  .stats {
    gap: 1rem;
  }

  .stat__value {
    font-size: clamp(2.75rem, min(22vw, 13vh), 6.5rem);
  }

  .stat__value--small {
    font-size: clamp(1.75rem, min(11vw, 7vh), 3.5rem);
  }

  .stat__label {
    margin-top: 0.2rem;
    font-size: 0.8rem;
  }

  .step-panel {
    padding: 0.75rem 1rem;
  }

  .step-panel__value {
    font-size: clamp(2.75rem, min(22vw, 13vh), 6.5rem);
  }

  .step-panel__btn {
    min-height: 3.25rem;
  }

  .btn {
    min-height: 4rem;
  }
}

.btn:disabled {
  opacity: 0.6;
}

.dev {
  text-align: center;
  font-size: 0.85rem;
  color: #9aa5b1;
}
</style>
