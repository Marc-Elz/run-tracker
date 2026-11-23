<script setup lang="ts">
import { ref, watch } from 'vue'
import SessionPicker from '@/components/SessionPicker.vue'
import { formatDistanceKm, formatDuration } from '@/lib/format'
import {
  compareToPlan,
  judgeRunSteps,
  plannedTotals,
  type PlanComparison,
  type RunStepVerdict,
} from '@/lib/planVsDone'
import { expandSteps } from '@/lib/stepProgress'
import {
  SESSION_TYPE_LABELS,
  sessionTitle,
  type ProgramSession,
  type SessionStep,
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
const sessionSteps = ref<SessionStep[]>([])
const program = ref<TrainingProgram | null>(null)
const comparison = ref<PlanComparison[]>([])
// How the run steps went (#134), for a gentle off-plan hint; the session stays done
const verdict = ref<RunStepVerdict | null>(null)
const hasPrograms = ref(false)
const busy = ref(false)
const failed = ref(false)

async function loadSession() {
  session.value = null
  sessionSteps.value = []
  program.value = null
  comparison.value = []
  verdict.value = null
  try {
    if (props.sessionId !== null) {
      const found = await training.getSession(props.sessionId)
      if (found) {
        session.value = found
        program.value = await training.getProgram(found.programId)
        sessionSteps.value = await training.loadSteps(found.id)
        const planned = plannedTotals(sessionSteps.value)
        comparison.value = compareToPlan(planned, {
          elapsedMs: props.elapsedMs,
          distanceM: props.distanceM,
        })
        verdict.value = judgeRunSteps(
          expandSteps(sessionSteps.value),
          await run.loadRunSteps(props.runId),
        )
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

// The picker (#148) is shared with the Run screen; this part stores the pick as the run's link
const picking = ref(false)

function openPicker() {
  failed.value = false
  picking.value = true
}

const fmt = (c: PlanComparison, value: number) =>
  c.kind === 'time' ? formatDuration(value * 1000) : `${formatDistanceKm(value)} km`
</script>

<template>
  <section v-if="session || hasPrograms" class="session" aria-label="Session">
    <h2 class="session__heading">Session</h2>

    <template v-if="session">
      <p class="session__name">
        {{ sessionTitle(session, sessionSteps) }}
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
      <p v-if="verdict?.offPlan" class="off-plan">
        Off plan: {{ verdict.offSteps }} of {{ verdict.runSteps }} run steps were slower than
        planned or cut short. Still counts as done.
      </p>
      <p v-if="comparison.length === 0" class="session__hint">
        This session has no planned total to compare with.
      </p>
      <button class="btn btn--secondary" :disabled="busy" @click="setLink(null)">
        Unlink from session
      </button>
    </template>

    <button v-else class="btn btn--secondary" :disabled="busy" @click="openPicker()">
      Link to a session
    </button>
    <p v-if="failed && !picking" class="notice" role="alert">Could not change the link.</p>
  </section>

  <SessionPicker
    v-if="picking"
    title="Link to a session"
    :busy="busy"
    :error="failed ? 'Could not link the run.' : null"
    @pick="(id) => setLink(id)"
    @close="picking = false"
  />
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

.off-plan {
  margin: -0.25rem 0 1rem;
  color: #f0b429;
  font-size: 0.95rem;
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
</style>
