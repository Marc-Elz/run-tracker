<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRunStore } from '@/stores/run'
import {
  formatClock,
  formatDistanceKm,
  formatDuration,
  formatPace,
  formatRunDate,
} from '@/lib/format'
import { paceSecPerKm } from '@/lib/runStats'
import type { RunRecord } from '@/lib/db/runRepository'

const run = useRunStore()
const runs = ref<RunRecord[]>([])
const loading = ref(true)
const failed = ref(false)

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

    <ul v-else class="list">
      <li v-for="r in runs" :key="r.id">
        <RouterLink :to="{ name: 'run-summary', params: { id: r.id } }" class="row">
          <span class="row__when">{{ formatRunDate(r.startedAt) }} · {{ formatClock(r.startedAt) }}</span>
          <span class="row__distance">{{ formatDistanceKm(r.distanceM) }} km</span>
          <span class="row__time">{{ formatDuration(r.elapsedMs) }}</span>
          <span class="row__pace">{{ formatPace(paceSecPerKm(r.elapsedMs, r.distanceM)) }} /km</span>
          <span class="row__chevron" aria-hidden="true">›</span>
        </RouterLink>
      </li>
    </ul>
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

.row__when {
  grid-area: when;
  font-size: 0.9rem;
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
