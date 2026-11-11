<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLeaveScreen } from '@/composables/useLeaveScreen'
import { useTrainingStore } from '@/stores/training'
import { useRunStore } from '@/stores/run'
import { followedProgramId, setFollowedProgram } from '@/lib/settings'
import type { RunRecord } from '@/lib/db/runRepository'
import { formatDistanceKm } from '@/lib/format'
import { plannedTotals, weekSummary, type PlannedTotals } from '@/lib/planVsDone'
import {
  localDate,
  nextSession,
  programWeek,
  SESSION_TYPE_LABELS,
  sessionTitle,
  type ProgramSession,
  type SessionStep,
  type TrainingProgram,
} from '@/lib/training'

const route = useRoute()
const router = useRouter()
const training = useTrainingStore()
const run = useRunStore()
const id = computed(() => route.params.id as string)
const leave = useLeaveScreen(() => ({ name: 'training' }))

const program = ref<TrainingProgram | null>(null)
const sessions = ref<ProgramSession[]>([])
const state = ref<'loading' | 'ready' | 'missing' | 'error'>('loading')
// Sessions with a finished run (#40); empty when they could not be read, so no marks show
const done = ref<ReadonlySet<string>>(new Set())
// Sessions marked skipped (#102); empty when they could not be read
const skipped = ref<ReadonlySet<string>>(new Set())
const finishedRuns = ref<RunRecord[]>([])
// Steps of every session, read at once (#138); empty when they could not be read
const steps = ref<ReadonlyMap<string, SessionStep[]>>(new Map())
const stepsFailed = ref(false)
const planned = computed<ReadonlyMap<string, PlannedTotals>>(() =>
  stepsFailed.value
    ? new Map()
    : new Map(
        sessions.value
          .filter((s) => s.type !== 'rest')
          .map((s) => [s.id, plannedTotals(steps.value.get(s.id) ?? [])] as const),
      ),
)
const next = computed(() => nextSession(sessions.value, done.value, skipped.value))
const following = computed(() => followedProgramId.value === id.value)

function toggleFollow() {
  setFollowedProgram(following.value ? null : id.value)
}

/** Every week of the program, empty ones included, with its sessions in order */
const weeks = computed(() =>
  Array.from({ length: program.value?.weeks ?? 0 }, (_, i) => ({
    week: i + 1,
    sessions: sessions.value.filter((s) => s.week === i + 1),
  })),
)

/** "1 of 3 sessions · 1 skipped · 20 of 60 min · 3.10 km", or null for a week with nothing to run */
function weekLine(weekSessions: ProgramSession[]): string | null {
  const w = weekSummary(weekSessions, planned.value, finishedRuns.value, skipped.value)
  if (w.sessions === 0) return null
  const parts = [`${w.done} of ${w.sessions} ${w.sessions === 1 ? 'session' : 'sessions'}`]
  if (w.skipped > 0) parts.push(`${w.skipped} skipped`)
  const minutes = Math.round(w.doneSeconds / 60)
  if (w.plannedSeconds !== null)
    parts.push(`${minutes} of ${Math.round(w.plannedSeconds / 60)} min`)
  else if (w.doneSeconds > 0) parts.push(`${minutes} min`)
  if (w.plannedMetres !== null) {
    parts.push(`${formatDistanceKm(w.doneMetres)} of ${formatDistanceKm(w.plannedMetres)} km`)
  } else if (w.doneMetres > 0) parts.push(`${formatDistanceKm(w.doneMetres)} km`)
  return parts.join(' · ')
}

/** The name after the type label, or null when it would only repeat the type ("Rest Rest") */
function rowTitle(s: ProgramSession): string | null {
  const title = sessionTitle(s, steps.value.get(s.id) ?? [])
  return title === SESSION_TYPE_LABELS[s.type] ? null : title
}

const weekLines = computed(
  () => new Map(weeks.value.map((w) => [w.week, weekLine(w.sessions)] as const)),
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
    // Each of these only adds marks and numbers, so a failure leaves the plain list
    try {
      finishedRuns.value = await run.listFinished()
      done.value = new Set(
        finishedRuns.value.flatMap((r) => (r.sessionId === null ? [] : [r.sessionId])),
      )
    } catch (err) {
      console.warn('[db] could not load the done sessions', err)
    }
    try {
      skipped.value = new Set(await training.skippedSessionIds())
    } catch (err) {
      console.warn('[db] could not load the skipped sessions', err)
    }
    try {
      steps.value = await training.loadProgramSteps(id.value)
      stepsFailed.value = false
    } catch (err) {
      // One message instead of every week silently losing its planned amounts (#138)
      console.warn('[db] could not load the steps', err)
      stepsFailed.value = true
    }
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
      <button
        class="btn btn--wide follow"
        :class="{ 'follow--on': following }"
        :aria-pressed="following"
        @click="toggleFollow()"
      >
        {{ following ? '✓ Following' : 'Follow this program' }}
      </button>

      <p v-if="stepsFailed" class="field-error steps-failed" role="alert">
        Could not read the steps; names and planned amounts may be missing
      </p>

      <section v-for="w in weeks" :key="w.week" class="week" :aria-labelledby="`week-${w.week}`">
        <h2 :id="`week-${w.week}`" class="week__title">Week {{ w.week }}</h2>
        <p v-if="weekLines.get(w.week)" class="week__summary">{{ weekLines.get(w.week) }}</p>
        <ul class="list">
          <li v-for="(s, i) in w.sessions" :key="s.id">
            <RouterLink
              :to="{ name: 'session-edit', params: { id, sid: s.id } }"
              class="row"
              :class="{
                'row--rest': s.type === 'rest',
                'row--done': done.has(s.id),
                'row--skipped': skipped.has(s.id) && !done.has(s.id),
              }"
            >
              <span v-if="done.has(s.id)" class="session__number" aria-label="Done">✓</span>
              <span v-else class="session__number">{{ i + 1 }}</span>
              <span class="session__type">{{ SESSION_TYPE_LABELS[s.type] }}</span>
              <span class="row__title session__title">{{ rowTitle(s) }}</span>
              <span v-if="skipped.has(s.id) && !done.has(s.id)" class="skipped">Skipped</span>
              <span v-else-if="next?.id === s.id" class="next">Next</span>
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

.steps-failed {
  margin: 1rem 1.5rem 0;
}

.week__title {
  margin: 0 1.5rem 0.5rem;
  color: #9aa5b1;
  font-size: 0.85rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.week__summary {
  margin: 0 1.5rem 0.5rem;
  color: #c3ccd5;
  font-variant-numeric: tabular-nums;
}

.row--skipped .session__title {
  color: #9aa5b1;
  text-decoration: line-through;
}

.skipped {
  flex-shrink: 0;
  color: #9aa5b1;
  font-size: 0.8rem;
  font-weight: 700;
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

.row--done .session__number {
  color: #1f9d55;
  font-weight: 700;
}

.row--done .session__title {
  color: #9aa5b1;
}

.next {
  flex-shrink: 0;
  padding: 0.15rem 0.5rem;
  border-radius: 0.5rem;
  background: #1f9d55;
  color: #fff;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.follow {
  margin-top: 0.75rem;
  background: #1a2027;
}

.follow--on {
  background: #1f6b42;
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
