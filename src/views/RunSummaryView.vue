<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import RouteMap from '@/components/RouteMap.vue'
import { useRunStore } from '@/stores/run'
import { formatClock, formatDistanceKm, formatDuration, formatPace, formatRunDate } from '@/lib/format'
import { buildGpx, gpxFileName } from '@/lib/gpx'
import { shareGpx } from '@/lib/shareRun'
import { buildRunSummary, toSegments, type RunSummary } from '@/lib/runSummary'
import type { RunRecord, StoredPoint } from '@/lib/db/runRepository'

const run = useRunStore()
const route = useRoute()
const router = useRouter()

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'error' } | { state: 'ready' }
const load = ref<Load>({ state: 'loading' })
const record = ref<RunRecord | null>(null)
const points = ref<StoredPoint[]>([])
const summary = ref<RunSummary | null>(null)

const exporting = ref(false)
const exportFailed = ref(false)
const confirming = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

const id = computed(() => String(route.params.id))

async function loadRun() {
  load.value = { state: 'loading' }
  try {
    const found = await run.getRun(id.value)
    if (!found) {
      load.value = { state: 'missing' }
      return
    }
    const stored = await run.loadPoints(id.value)
    record.value = found
    points.value = stored
    summary.value = buildRunSummary(found, stored)
    load.value = { state: 'ready' }
  } catch (err) {
    console.warn('[db] could not load run', err)
    load.value = { state: 'error' }
  }
}

function goBack() {
  // From History go back to it; right after Stop there is nothing useful behind, so the Run tab
  if (window.history.state?.back) router.back()
  else void router.replace({ name: 'run' })
}

async function onExport() {
  if (exporting.value || !record.value) return
  exporting.value = true
  exportFailed.value = false
  try {
    const { startedAt, segment } = record.value
    await shareGpx(gpxFileName(startedAt), buildGpx(startedAt, toSegments(points.value, segment)))
  } catch (err) {
    console.warn('GPX export failed', err)
    exportFailed.value = true
  } finally {
    exporting.value = false
  }
}

async function onDelete() {
  if (deleting.value) return
  deleting.value = true
  deleteError.value = null
  try {
    await run.deleteRun(id.value)
    confirming.value = false
    await router.replace({ name: 'history' })
  } catch (err) {
    console.warn('[db] could not delete run', err)
    deleteError.value = 'Could not delete the run'
  } finally {
    deleting.value = false
  }
}

onMounted(loadRun)
</script>

<template>
  <main class="summary">
    <header class="bar">
      <button class="back" @click="goBack()">‹ Back</button>
      <p v-if="record" class="when">{{ formatRunDate(record.startedAt) }} · {{ formatClock(record.startedAt) }}</p>
    </header>

    <p v-if="load.state === 'loading'" class="message">Loading…</p>

    <section v-else-if="load.state === 'missing'" class="message">
      <p>Run not found</p>
      <button class="btn btn--secondary" @click="router.replace({ name: 'history' })">
        Back to History
      </button>
    </section>

    <section v-else-if="load.state === 'error'" class="message">
      <p>Could not load the run</p>
      <button class="btn btn--secondary" @click="loadRun()">Retry</button>
    </section>

    <template v-else-if="summary && record">
      <RouteMap :route="summary" />

      <section class="stats">
        <div class="stat">
          <span class="stat__value">{{ formatDistanceKm(summary.distanceM) }}</span>
          <span class="stat__label">Distance (km)</span>
        </div>
        <div class="stat">
          <span class="stat__value">{{ formatDuration(summary.elapsedMs) }}</span>
          <span class="stat__label">Time</span>
        </div>
        <div class="stat">
          <span class="stat__value">{{ formatDuration(summary.movingMs) }}</span>
          <span class="stat__label">Moving</span>
        </div>
        <div class="stat">
          <span class="stat__value">{{ formatPace(summary.avgPaceSecPerKm) }}</span>
          <span class="stat__label">Avg pace (min/km)</span>
        </div>
      </section>

      <p v-if="exportFailed" class="notice" role="alert">Could not export the run.</p>

      <section class="actions">
        <button class="btn btn--secondary" :disabled="exporting" @click="onExport()">
          Export GPX
        </button>
        <button class="btn btn--danger" @click="confirming = true">Delete</button>
      </section>
    </template>

    <ConfirmDialog
      v-if="confirming"
      title="Delete this run?"
      :busy="deleting"
      :error="deleteError"
      @keep="confirming = false"
      @confirm="onDelete()"
    >
      Its GPS track is deleted too. This cannot be undone.
    </ConfirmDialog>
  </main>
</template>

<style scoped>
.summary {
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  background: #101418;
  color: #f4f6f8;
  font-family: system-ui, sans-serif;
}

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 3.5rem;
  padding: env(safe-area-inset-top) 0.5rem 0;
}

.back {
  min-height: 3.5rem;
  padding: 0 1rem;
  border: 0;
  background: none;
  color: #f4f6f8;
  font-size: 1.1rem;
  font-weight: 600;
}

.when {
  margin: 0 1rem 0 0;
  color: #9aa5b1;
}

.message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  margin: 3rem 1.5rem;
  color: #9aa5b1;
  font-size: 1.1rem;
}

.message p {
  margin: 0;
}

.stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem 1rem;
  padding: 1.5rem;
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
  font-size: clamp(2.25rem, 12vw, 3.5rem);
}

.stat__label {
  margin-top: 0.4rem;
  font-size: 0.85rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #9aa5b1;
}

.notice {
  margin: 0 1.5rem 1rem;
  padding: 1rem;
  border-radius: 1rem;
  background: #5c3a12;
  color: #ffe2b8;
}

.actions {
  display: flex;
  gap: 1rem;
  padding: 0 1.5rem 1.5rem;
}

.btn {
  flex: 1;
  min-height: 3.5rem;
  border: 0;
  border-radius: 1rem;
  font-size: 1.1rem;
  font-weight: 700;
  color: #fff;
}

.btn--secondary {
  background: #3b4652;
}

.btn--danger {
  background: #d64545;
}

.btn:disabled {
  opacity: 0.6;
}
</style>
