<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useTrainingStore } from '@/stores/training'
import type { ProgramSummary } from '@/lib/training'

const training = useTrainingStore()
const programs = ref<ProgramSummary[]>([])
const loading = ref(true)
const failed = ref(false)

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
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
