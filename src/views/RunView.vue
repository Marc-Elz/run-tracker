<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRunStore } from '@/stores/run'
import { useKeepAwake } from '@/composables/useKeepAwake'
import { GpsError, openAppSettings, startGps, type GpsFailure } from '@/lib/gps'
import { ensureBatteryExemption, ensureNotifications } from '@/lib/runPower'
import { formatDistanceKm, formatDuration, formatPace } from '@/lib/format'

const run = useRunStore()
const { status, hasFix, distanceM, elapsedMs, averagePaceSecPerKm, currentPaceSecPerKm } =
  storeToRefs(run)

useKeepAwake(computed(() => status.value === 'running' || status.value === 'paused'))

const isDev = import.meta.env.DEV
const simulate = ref(isDev)
const starting = ref(false)
const gpsFailure = ref<GpsFailure | null>(null)
const batteryHint = ref(false)
let stopGps: (() => void) | null = null

function endGps() {
  stopGps?.()
  stopGps = null
}

function onGpsError(err: Error) {
  if (!(err instanceof GpsError)) return // transient; the run carries on
  endGps()
  gpsFailure.value = err.failure
  // Refused right at the start: back to the start screen. Mid-run: keep what was recorded.
  if (run.points.length === 0) run.reset()
}

async function onStart() {
  if (starting.value || status.value !== 'idle') return
  starting.value = true
  gpsFailure.value = null
  try {
    await ensureNotifications()
    batteryHint.value = !(await ensureBatteryExemption())
    // The clock starts on the tap; fixes come in once GPS has a signal ("Acquiring GPS")
    run.start()
    stopGps = await startGps(run.addPoint, onGpsError, { simulate: isDev && simulate.value })
  } catch (err) {
    console.warn('GPS could not start', err)
    run.reset()
  } finally {
    starting.value = false
  }
}

// GPS stays on while paused (the store ignores those fixes) and stops with the run
watch(status, (s) => {
  if (s === 'finished' || s === 'idle') endGps()
})
onBeforeUnmount(endGps)
</script>

<template>
  <main class="run" :data-status="status">
    <p v-if="status === 'running' && !hasFix && !gpsFailure" class="gps-status">Acquiring GPS…</p>

    <section class="stats" aria-live="off">
      <div class="stat stat--time">
        <span class="stat__value">{{ formatDuration(elapsedMs) }}</span>
        <span class="stat__label">Time</span>
      </div>
      <div class="stat stat--distance">
        <span class="stat__value">{{ formatDistanceKm(distanceM) }}</span>
        <span class="stat__label">Distance (km)</span>
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

    <p v-if="batteryHint && status !== 'finished'" class="notice">
      Battery optimisation is on, so Android may stop the run. On Samsung: Settings › Battery ›
      Background usage limits › Never sleeping apps, add Run Tracker.
    </p>

    <section class="controls">
      <button
        v-if="status === 'idle'"
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
        <button class="btn btn--primary" @click="run.resume()">Resume</button>
        <button class="btn btn--danger" @click="run.stop()">Stop</button>
      </template>

      <button v-else class="btn btn--primary" @click="run.reset()">Done</button>
    </section>

    <label v-if="status === 'idle' && isDev" class="dev">
      <input v-model="simulate" type="checkbox" /> Simulate GPS (dev only)
    </label>
  </main>
</template>

<style scoped>
.run {
  min-height: 100dvh;
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

.btn--primary {
  background: #1f9d55;
}

.btn--secondary {
  background: #3b4652;
}

.btn--danger {
  background: #d64545;
}

.run[data-status='paused'] .stat__value {
  opacity: 0.6;
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

.notice p {
  margin: 0;
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
