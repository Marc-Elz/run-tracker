<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useTrainingStore } from '@/stores/training'
import { timerPresets } from '@/lib/settings'
import type { ProgramSummary } from '@/lib/training'

const training = useTrainingStore()
const programs = ref<ProgramSummary[]>([])
const loading = ref(true)
const failed = ref(false)

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const timerDetail = computed(() => {
  const [first, ...more] = timerPresets.value
  if (!first) return ''
  return more.length === 0
    ? first.name
    : `${first.name} and ${plural(more.length, 'more preset', 'more presets')}`
})
const detail = (p: ProgramSummary) =>
  [p.goal, plural(p.weeks, 'week', 'weeks'), plural(p.sessionCount, 'session', 'sessions')]
    .filter(Boolean)
    .join(' · ')

async function load() {
  loading.value = true
  failed.value = false
  try {
    programs.value = await training.listPrograms()
  } catch (err) {
    console.warn('[db] could not list programs', err)
    failed.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <main class="page page--top">
    <h1>Training</h1>

    <!-- The exercise timer (#124) needs no database, so it shows even when programs fail -->
    <RouterLink :to="{ name: 'timer' }" class="row timer-row">
      <span class="row__main">
        <span class="row__title">⏱ Timer</span>
        <span class="row__detail">{{ timerDetail }}</span>
      </span>
      <span class="row__chevron" aria-hidden="true">›</span>
    </RouterLink>

    <section v-if="failed" class="message">
      <p>Could not load programs</p>
      <button class="btn" @click="load()">Retry</button>
    </section>

    <template v-else-if="!loading">
      <p v-if="programs.length === 0" class="message">
        No training programs yet. Add the schedule you follow, week by week.
      </p>
      <ul class="list">
        <li v-for="p in programs" :key="p.id">
          <RouterLink :to="{ name: 'program', params: { id: p.id } }" class="row">
            <span class="row__main">
              <span class="row__title">{{ p.name }}</span>
              <span class="row__detail">{{ detail(p) }}</span>
            </span>
            <span class="row__chevron" aria-hidden="true">›</span>
          </RouterLink>
        </li>
      </ul>
      <RouterLink :to="{ name: 'program-new' }" class="btn btn--primary btn--wide">
        + New program
      </RouterLink>
    </template>
  </main>
</template>

<style scoped src="./training.css"></style>

<style scoped>
/* Set apart from the programs below it */
.timer-row {
  margin-bottom: 1rem;
  border-bottom: 1px solid #2a2f36;
}
</style>
