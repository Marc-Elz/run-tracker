<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLeaveScreen } from '@/composables/useLeaveScreen'
import { useTrainingStore } from '@/stores/training'
import {
  localDate,
  programWeek,
  SESSION_TYPE_LABELS,
  type ProgramSession,
  type TrainingProgram,
} from '@/lib/training'

const route = useRoute()
const router = useRouter()
const training = useTrainingStore()
const id = computed(() => route.params.id as string)
const leave = useLeaveScreen(() => ({ name: 'training' }))

const program = ref<TrainingProgram | null>(null)
const sessions = ref<ProgramSession[]>([])
const state = ref<'loading' | 'ready' | 'missing' | 'error'>('loading')

/** Every week of the program, empty ones included, with its sessions in order */
const weeks = computed(() =>
  Array.from({ length: program.value?.weeks ?? 0 }, (_, i) => ({
    week: i + 1,
    sessions: sessions.value.filter((s) => s.week === i + 1),
  })),
)

const where = computed(() => {
  const p = program.value
  if (!p?.startDate) return null
  const at = programWeek(p.startDate, p.weeks, localDate(Date.now()))
  if (at === null) return null
  if (at.kind === 'in') return `Week ${at.week} of ${p.weeks}`
  if (at.kind === 'after') return 'Finished'
  return at.daysToStart === 1 ? 'Starts tomorrow' : `Starts in ${at.daysToStart} days`
})

const subtitle = computed(() => {
  const p = program.value
  if (!p) return ''
  return [p.goal, `${p.weeks} ${p.weeks === 1 ? 'week' : 'weeks'}`].filter(Boolean).join(' · ')
})

async function load() {
  state.value = 'loading'
  try {
    const found = await training.getProgram(id.value)
    if (!found) {
      state.value = 'missing'
      return
    }
    program.value = found
    sessions.value = await training.listSessions(id.value)
    state.value = 'ready'
  } catch (err) {
    console.warn('[db] could not load program', err)
    state.value = 'error'
  }
}

onMounted(load)
</script>

<template>
  <main class="page">
    <header class="bar">
      <button class="back" @click="leave()">‹ Back</button>
      <RouterLink
        v-if="state === 'ready'"
        class="back edit"
        :to="{ name: 'program-edit', params: { id } }"
      >
        Edit
      </RouterLink>
    </header>

    <p v-if="state === 'loading'" class="message">Loading…</p>

    <section v-else-if="state === 'missing'" class="message">
      <p>This program no longer exists</p>
      <button class="btn" @click="router.replace({ name: 'training' })">Back to Training</button>
    </section>

    <section v-else-if="state === 'error'" class="message">
      <p>Could not load the program</p>
      <button class="btn" @click="load()">Retry</button>
    </section>

    <template v-else-if="program">
      <h1 class="title">{{ program.name }}</h1>
      <p class="message subtitle">{{ subtitle }}</p>
      <p v-if="where" class="where">{{ where }}</p>

      <section v-for="w in weeks" :key="w.week" class="week" :aria-labelledby="`week-${w.week}`">
        <h2 :id="`week-${w.week}`" class="week__title">Week {{ w.week }}</h2>
        <ul class="list">
          <li v-for="(s, i) in w.sessions" :key="s.id">
            <RouterLink
              :to="{ name: 'session-edit', params: { id, sid: s.id } }"
              class="row"
              :class="{ 'row--rest': s.type === 'rest' }"
            >
              <span class="session__number">{{ i + 1 }}</span>
              <span class="session__type">{{ SESSION_TYPE_LABELS[s.type] }}</span>
              <span class="row__title session__title">{{ s.title }}</span>
              <span class="row__chevron" aria-hidden="true">›</span>
            </RouterLink>
          </li>
        </ul>
        <p v-if="w.sessions.length === 0" class="empty-week">No sessions</p>
        <RouterLink
          :to="{ name: 'session-new', params: { id }, query: { week: w.week } }"
          class="btn btn--wide add"
        >
          + Add session to week {{ w.week }}
        </RouterLink>
      </section>
    </template>
  </main>
</template>

<style scoped src="./training.css"></style>

<style scoped>
.edit {
  display: flex;
  align-items: center;
  text-decoration: none;
}

.title {
  margin-bottom: 0.25rem;
}

.subtitle {
  margin-bottom: 0.25rem;
}

.where {
  margin: 0 1.5rem 0.5rem;
  color: #1f9d55;
  font-weight: 700;
}

.week {
  margin-top: 1.5rem;
}

.week__title {
  margin: 0 1.5rem 0.5rem;
  color: #9aa5b1;
  font-size: 0.85rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.session__number {
  width: 1.25rem;
  color: #9aa5b1;
  font-variant-numeric: tabular-nums;
}

.session__type {
  width: 5.5rem;
  flex-shrink: 0;
  color: #9aa5b1;
  font-size: 0.95rem;
}

.session__title {
  flex: 1;
  min-width: 0;
}

.row--rest {
  opacity: 0.6;
}

.empty-week {
  margin: 0;
  padding: 0.75rem 1.5rem;
  border-top: 1px solid #2a2f36;
  color: #9aa5b1;
}

.add {
  margin-top: 0.5rem;
  background: #1a2027;
  font-size: 1rem;
}
</style>
