<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useBackInterceptor } from '@/composables/useBackButton'
import { formatDistanceKm, formatDuration } from '@/lib/format'
import { compareToPlan, plannedTotals, type PlanComparison } from '@/lib/planVsDone'
import { followedProgramId } from '@/lib/settings'
import {
  SESSION_TYPE_LABELS,
  type ProgramSession,
  type ProgramSummary,
  type TrainingProgram,
} from '@/lib/training'
import { useRunStore } from '@/stores/run'
import { useTrainingStore } from '@/stores/training'

/**
 * The "Session" part of the run summary (#102): which session this run belongs to and how it went
 * against the plan, or a way to link a run that was started without one. Training data that can't
 * be read only hides the part: the rest of the summary must still show.
 */
const props = defineProps<{
  runId: string
  sessionId: string | null
  /** The run's totals, to set against the plan */
  elapsedMs: number
  distanceM: number
}>()
const emit = defineEmits<{ linked: [sessionId: string | null] }>()

const run = useRunStore()
const training = useTrainingStore()

const session = ref<ProgramSession | null>(null)
const program = ref<TrainingProgram | null>(null)
const comparison = ref<PlanComparison[]>([])
const hasPrograms = ref(false)
const busy = ref(false)
const failed = ref(false)

async function loadSession() {
  session.value = null
  program.value = null
  comparison.value = []
  try {
    if (props.sessionId !== null) {
      const found = await training.getSession(props.sessionId)
      if (found) {
        session.value = found
        program.value = await training.getProgram(found.programId)
        const planned = plannedTotals(await training.loadSteps(found.id))
        comparison.value = compareToPlan(planned, {
          elapsedMs: props.elapsedMs,
          distanceM: props.distanceM,
        })
      }
    } else {
      hasPrograms.value = (await training.listPrograms()).length > 0
    }
  } catch (err) {
    console.warn('[db] could not read the session of this run', err)
  }
}
watch(() => props.sessionId, loadSession, { immediate: true })

async function setLink(next: string | null) {
  if (busy.value) return
  busy.value = true
  failed.value = false
  try {
    const stored = await run.linkRun(props.runId, next)
    picking.value = false
    emit('linked', stored)
  } catch (err) {
    console.warn('[db] could not link the run', err)
    failed.value = true
  } finally {
    busy.value = false
  }
}

// The picker: choose a program, then one of its sessions
const picking = ref(false)
const programs = ref<ProgramSummary[]>([])
const programId = ref<string | null>(null)
const sessions = ref<ProgramSession[]>([])
const doneIds = ref<ReadonlySet<string>>(new Set())
const loadingPicker = ref(false)

useBackInterceptor(picking, () => {
  if (!busy.value) picking.value = false
})

/** The runnable sessions of the chosen program, by week then position (rest days can't be run) */
const choices = computed(() => sessions.value.filter((s) => s.type !== 'rest'))

async function openPicker() {
  failed.value = false
  picking.value = true
  loadingPicker.value = true
  try {
    programs.value = await training.listPrograms()
    const followed = programs.value.find((p) => p.id === followedProgramId.value)
    programId.value = (followed ?? programs.value[0])?.id ?? null
    doneIds.value = new Set(await run.doneSessionIds())
    await loadChoices()
  } catch (err) {
    console.warn('[db] could not list the sessions to link', err)
    failed.value = true
  } finally {
    loadingPicker.value = false
  }
}

async function loadChoices() {
  sessions.value = programId.value === null ? [] : await training.listSessions(programId.value)
}

async function changeProgram() {
  try {
    await loadChoices()
  } catch (err) {
    console.warn('[db] could not list the sessions to link', err)
    failed.value = true
  }
}

const fmt = (c: PlanComparison, value: number) =>
  c.kind === 'time' ? formatDuration(value * 1000) : `${formatDistanceKm(value)} km`
</script>

<template>
  <section v-if="session || hasPrograms" class="session" aria-label="Session">
    <h2 class="session__heading">Session</h2>

    <template v-if="session">
      <p class="session__name">
        {{ session.title }}
        <span class="session__where">
          · {{ program?.name }} · Week {{ session.week }} · {{ SESSION_TYPE_LABELS[session.type] }}
        </span>
      </p>
      <ul v-if="comparison.length > 0" class="plan">
        <li v-for="c in comparison" :key="c.kind" class="plan__row">
          <span class="plan__kind">{{ c.kind === 'time' ? 'Time' : 'Distance' }}</span>
          <span class="plan__done">{{ fmt(c, c.done) }}</span>
          <span class="plan__planned">planned {{ fmt(c, c.planned) }}</span>
        </li>
      </ul>
      <p v-else class="session__hint">This session has no planned total to compare with.</p>
      <button class="btn btn--secondary" :disabled="busy" @click="setLink(null)">
        Unlink from session
      </button>
    </template>

    <button v-else class="btn btn--secondary" :disabled="busy" @click="openPicker()">
      Link to a session
    </button>
    <p v-if="failed && !picking" class="notice" role="alert">Could not change the link.</p>
  </section>

  <div v-if="picking" class="backdrop" @click.self="!busy && (picking = false)">
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Link to a session">
      <h2>Link to a session</h2>
      <label v-if="programs.length > 1" class="field">
        <span>Program</span>
        <select v-model="programId" :disabled="busy" @change="changeProgram()">
          <option v-for="p in programs" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <p v-if="loadingPicker" class="session__hint">Loading…</p>
      <ul v-else class="choices">
        <li v-for="s in choices" :key="s.id">
          <button class="choice" :disabled="busy" @click="setLink(s.id)">
            <span class="choice__week">W{{ s.week }}</span>
            <span class="choice__title">{{ s.title }}</span>
            <span v-if="doneIds.has(s.id)" class="choice__done" aria-label="Done">✓</span>
          </button>
        </li>
        <li v-if="choices.length === 0" class="session__hint">
          This program has no sessions to run.
        </li>
      </ul>
      <p v-if="failed" class="notice" role="alert">Could not link the run.</p>
      <button class="btn btn--secondary" :disabled="busy" @click="picking = false">Cancel</button>
    </div>
  </div>
</template>

<style scoped>
.session {
  padding: 0 1.5rem 1.5rem;
}

.session__heading {
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #9aa5b1;
}

.session__name {
  margin: 0 0 0.75rem;
  font-size: 1.2rem;
  font-weight: 700;
}

.session__where,
.session__hint {
  font-size: 0.95rem;
  font-weight: 400;
  color: #9aa5b1;
}

.session__hint {
  margin: 0 0 0.75rem;
}

.plan {
  margin: 0 0 1rem;
  padding: 0;
  list-style: none;
}

.plan__row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 1rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid #2a323b;
  font-size: 1.1rem;
  font-variant-numeric: tabular-nums;
}

.plan__done {
  font-weight: 700;
}

.plan__kind,
.plan__planned {
  color: #9aa5b1;
}

.btn {
  box-sizing: border-box;
  width: 100%;
  min-height: 3.5rem;
  border: 0;
  border-radius: 1rem;
  background: #3b4652;
  color: #fff;
  font-size: 1.1rem;
  font-weight: 700;
}

.btn:disabled {
  opacity: 0.6;
}

.notice {
  margin: 0.75rem 0 0;
  color: #ffb3b3;
}

.backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgb(0 0 0 / 0.65);
}

.dialog {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
  max-width: 24rem;
  max-height: 80vh;
  padding: 1.25rem;
  border-radius: 1rem;
  background: #1a2027;
  color: #f4f6f8;
  font-family: system-ui, sans-serif;
}

.dialog h2 {
  margin: 0;
  font-size: 1.3rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  color: #9aa5b1;
}

.field select {
  min-height: 3.5rem;
  padding: 0 0.75rem;
  border: 2px solid #3b4652;
  border-radius: 1rem;
  background: #101418;
  color: #f4f6f8;
  font-size: 1.1rem;
}

.choices {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.choice {
  display: grid;
  grid-template-columns: 3rem 1fr auto;
  align-items: center;
  width: 100%;
  min-height: 3.5rem;
  padding: 0 0.5rem;
  border: 0;
  border-bottom: 1px solid #2a323b;
  background: none;
  color: #f4f6f8;
  font-size: 1.1rem;
  text-align: left;
}

.choice__week {
  color: #9aa5b1;
}

.choice__done {
  color: #6fcf97;
}
</style>
