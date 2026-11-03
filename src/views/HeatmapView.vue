<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import RoutesMap from '@/components/RoutesMap.vue'
import { useRunStore } from '@/stores/run'
import { useBackInterceptor } from '@/composables/useBackButton'
import {
  formatClock,
  formatDistanceKm,
  formatDuration,
  formatPace,
  formatRunDate,
  runTitle,
} from '@/lib/format'
import { paceSecPerKm } from '@/lib/runStats'
import type { RunRecord } from '@/lib/db/runRepository'
import type { RouteOverview } from '@/lib/routeOverview'

const run = useRunStore()
const router = useRouter()

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready' }
const load = ref<Load>({ state: 'loading' })
const progress = ref<{ done: number; total: number } | null>(null)
const runs = ref(new Map<string, RunRecord>())
// Only runs that have a route to draw
const overviews = ref<RouteOverview[]>([])
const failed = ref(0)

// Runs under the last tap, newest first, and which of them the card shows
const picked = ref<string[]>([])
const index = ref(0)
const selectedId = computed(() => picked.value[index.value] ?? null)
const selected = computed(() => (selectedId.value ? (runs.value.get(selectedId.value) ?? null) : null))

async function loadRoutes() {
  load.value = { state: 'loading' }
  progress.value = null
  picked.value = []
  try {
    const result = await run.loadOverviews((done, total) => (progress.value = { done, total }))
    runs.value = new Map(result.runs.map((r) => [r.id, r]))
    overviews.value = result.overviews.filter((o) => o.lines.length > 0)
    failed.value = result.failed
    load.value = { state: 'ready' }
  } catch (err) {
    console.warn('[db] could not load routes', err)
    load.value = { state: 'error' }
  }
}

function onTap(ids: string[]) {
  picked.value = ids
    .filter((id) => runs.value.has(id))
    .sort((a, b) => runs.value.get(b)!.startedAt - runs.value.get(a)!.startedAt)
  index.value = 0
}

function step(by: number) {
  const n = picked.value.length
  index.value = (index.value + by + n) % n
}

function goBack() {
  if (window.history.state?.back) router.back()
  else void router.replace({ name: 'history' })
}

function openRun() {
  if (selectedId.value) void router.push({ name: 'run-summary', params: { id: selectedId.value } })
}

// Android back clears the selection first, then leaves the screen
useBackInterceptor(
  computed(() => picked.value.length > 0),
  () => (picked.value = []),
)

onMounted(loadRoutes)
</script>

<template>
  <main class="heatmap">
    <header class="bar">
      <button class="back" @click="goBack()">‹ Back</button>
      <span v-if="load.state === 'ready' && overviews.length > 0" class="count">
        {{ overviews.length }} {{ overviews.length === 1 ? 'run' : 'runs' }}
      </span>
    </header>

    <div class="stage">
      <p v-if="load.state === 'loading'" class="message" role="status">
        {{ progress ? `Preparing routes… ${progress.done} / ${progress.total}` : 'Loading…' }}
      </p>

      <section v-else-if="load.state === 'error'" class="message">
        <p>Could not load routes</p>
        <button class="btn" @click="loadRoutes()">Retry</button>
      </section>

      <p v-else-if="overviews.length === 0" class="message">
        No routes to show yet. Record a run on the Run tab.
      </p>

      <template v-else>
        <RoutesMap :overviews="overviews" :selected-id="selectedId" @tap="onTap" />
        <p v-if="failed > 0" class="skipped" role="status">
          {{ failed }} {{ failed === 1 ? 'run' : 'runs' }} could not be drawn
        </p>

        <section v-if="selected" class="card" aria-label="Selected run">
          <div class="card__head">
            <div class="card__title">
              <span class="card__name">{{ runTitle(selected) }}</span>
              <span class="card__when">
                {{ formatRunDate(selected.startedAt) }} · {{ formatClock(selected.startedAt) }}
              </span>
            </div>
            <div v-if="picked.length > 1" class="pager">
              <button class="pager__btn" aria-label="Previous run" @click="step(-1)">‹</button>
              <span class="pager__count">{{ index + 1 }}/{{ picked.length }}</span>
              <button class="pager__btn" aria-label="Next run" @click="step(1)">›</button>
            </div>
          </div>
          <p class="card__stats">
            {{ formatDistanceKm(selected.distanceM) }} km · {{ formatDuration(selected.elapsedMs) }} ·
            {{ formatPace(paceSecPerKm(selected.elapsedMs, selected.distanceM)) }} /km
          </p>
          <button class="btn btn--primary" @click="openRun()">Open</button>
        </section>
      </template>
    </div>
  </main>
</template>

<style scoped>
.heatmap {
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
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
  padding: env(safe-area-inset-top) 1rem 0 0.5rem;
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

.count {
  color: #9aa5b1;
  font-variant-numeric: tabular-nums;
}

.stage {
  position: relative;
  flex: 1;
  min-height: 0;
}

.message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  height: 100%;
  margin: 0;
  padding: 0 1.5rem;
  box-sizing: border-box;
  text-align: center;
  color: #9aa5b1;
  font-size: 1.1rem;
}

.skipped {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  margin: 0;
  padding: 0.25rem 0.6rem;
  border-radius: 0.5rem;
  background: rgb(26 32 39 / 0.9);
  color: #9aa5b1;
  font-size: 0.85rem;
  pointer-events: none;
}

.card {
  position: absolute;
  left: 0.75rem;
  right: 0.75rem;
  bottom: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  border-radius: 1rem;
  background: #1a2027;
  box-shadow: 0 2px 12px rgb(0 0 0 / 0.5);
}

.card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.card__title {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.card__name {
  overflow: hidden;
  font-size: 1.2rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card__when {
  font-size: 0.85rem;
  color: #9aa5b1;
}

.card__stats {
  margin: 0;
  font-size: 1.1rem;
  font-variant-numeric: tabular-nums;
}

.pager {
  display: flex;
  align-items: center;
  flex: none;
}

.pager__btn {
  width: 3.5rem;
  min-height: 3.5rem;
  border: 0;
  background: none;
  color: #f4f6f8;
  font-size: 1.6rem;
}

.pager__count {
  min-width: 2.5rem;
  text-align: center;
  color: #9aa5b1;
  font-variant-numeric: tabular-nums;
}

.btn {
  min-height: 3.5rem;
  padding: 0 1.5rem;
  border: 0;
  border-radius: 1rem;
  background: #2a2f36;
  color: #fff;
  font-size: 1.1rem;
  font-weight: 700;
}

.btn--primary {
  background: #2f7de1;
}
</style>
