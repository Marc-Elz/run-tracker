<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRunStore } from '@/stores/run'
import {
  formatClock,
  formatDistanceKm,
  formatDuration,
  formatPace,
  formatRunDate,
  runTitle,
} from '@/lib/format'
import { summarizeRuns } from '@/lib/historyStats'
import { paceSecPerKm } from '@/lib/runStats'
import type { RunRecord } from '@/lib/db/runRepository'

const run = useRunStore()
const runs = ref<RunRecord[]>([])
const loading = ref(true)
const failed = ref(false)
const stats = computed(() => summarizeRuns(runs.value, Date.now()))
const periods = computed(() => [
  { label: 'This week', totals: stats.value.week },
  { label: 'This month', totals: stats.value.month },
  { label: 'All time', totals: stats.value.all },
])

async function load() {
  loading.value = true
  failed.value = false
  try {
    runs.value = await run.listFinished()
  } catch (err) {
    console.warn('[db] could not list runs', err)
    failed.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <main class="history">
    <h1>History</h1>

    <section v-if="failed" class="empty">
      <p>Could not load runs</p>
      <button class="btn" @click="load()">Retry</button>
    </section>

    <p v-else-if="!loading && runs.length === 0" class="empty">
      No runs yet. Record one on the Run tab.
    </p>

    <template v-else>
      <section v-if="runs.length > 0" class="stats" aria-label="Totals">
        <div v-for="p in periods" :key="p.label" class="stats__period">
          <span class="stats__label">{{ p.label }}</span>
          <span class="stats__distance">{{ formatDistanceKm(p.totals.distanceM) }} km</span>
          <span class="stats__detail">
            {{ formatDuration(p.totals.elapsedMs) }} · {{ p.totals.count }}
            {{ p.totals.count === 1 ? 'run' : 'runs' }}
          </span>
        </div>
        <p class="stats__records">
          Longest {{ formatDistanceKm(stats.longestM) }} km · Best pace
          {{ formatPace(stats.bestPaceSecPerKm) }} /km
        </p>
      </section>

      <ul class="list">
        <li v-for="r in runs" :key="r.id">
          <RouterLink :to="{ name: 'run-summary', params: { id: r.id } }" class="row">
            <span class="row__head">
              <span class="row__when" :class="{ 'row__when--named': r.name }">{{
                runTitle(r)
              }}</span>
              <span v-if="r.name" class="row__date">
                {{ formatRunDate(r.startedAt) }} · {{ formatClock(r.startedAt) }}
              </span>
            </span>
            <span class="row__distance">{{ formatDistanceKm(r.distanceM) }} km</span>
            <span class="row__time">{{ formatDuration(r.elapsedMs) }}</span>
            <span class="row__pace"
              >{{ formatPace(paceSecPerKm(r.elapsedMs, r.distanceM)) }} /km</span
            >
            <span class="row__chevron" aria-hidden="true">›</span>
          </RouterLink>
        </li>
      </ul>
    </template>
  </main>
</template>

<style scoped>
.history {
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: max(1.5rem, env(safe-area-inset-top)) 0 0;
  background: #101418;
  color: #f4f6f8;
  font-family: system-ui, sans-serif;
}

h1 {
  margin: 0 1.5rem 1rem;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  margin: 0 1.5rem 1rem;
}

.stats__period {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.stats__label {
  font-size: 0.8rem;
  color: #9aa5b1;
}

.stats__distance {
  font-size: 1.3rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.stats__detail {
  font-size: 0.8rem;
  color: #9aa5b1;
  font-variant-numeric: tabular-nums;
}

.stats__records {
  grid-column: 1 / -1;
  margin: 0.5rem 0 0;
  color: #9aa5b1;
  font-variant-numeric: tabular-nums;
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  grid-template-areas:
    'when when when chevron'
    'distance time pace chevron';
  align-items: center;
  column-gap: 1rem;
  min-height: 4.5rem;
  box-sizing: border-box;
  padding: 0.75rem 1.5rem;
  border-top: 1px solid #2a2f36;
  color: inherit;
  text-decoration: none;
}

.row__head {
  grid-area: when;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.row__when {
  overflow: hidden;
  font-size: 0.9rem;
  color: #9aa5b1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__when--named {
  font-size: 1.1rem;
  font-weight: 700;
  color: #f4f6f8;
}

.row__date {
  font-size: 0.85rem;
  color: #9aa5b1;
}

.row__distance {
  grid-area: distance;
  font-size: 1.5rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.row__time {
  grid-area: time;
  font-size: 1.1rem;
  font-variant-numeric: tabular-nums;
}

.row__pace {
  grid-area: pace;
  font-size: 1.1rem;
  color: #9aa5b1;
  font-variant-numeric: tabular-nums;
}

.row__chevron {
  grid-area: chevron;
  font-size: 1.8rem;
  color: #9aa5b1;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  margin: 2rem 1.5rem;
  color: #9aa5b1;
}

.empty p {
  margin: 0;
}

.btn {
  min-height: 3.5rem;
  padding: 0 2rem;
  border: 0;
  border-radius: 1rem;
  background: #3b4652;
  color: #fff;
  font-size: 1.1rem;
  font-weight: 700;
}
</style>
