<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useBackInterceptor } from '@/composables/useBackButton'
import { useLeaveScreen } from '@/composables/useLeaveScreen'
import { useTrainingStore } from '@/stores/training'
import {
  addStep,
  findStep,
  formatMinSec,
  parseMinSec,
  removeStep,
  replaceStep,
  STEP_KIND_LABELS,
  STEP_KINDS,
  TrainingError,
  type SessionStep,
  type StepBlock,
  type StepKind,
  type TargetKind,
} from '@/lib/training'

const route = useRoute()
const router = useRouter()
const training = useTrainingStore()

const programId = computed(() => route.params.id as string)
const sessionId = computed(() => route.params.sid as string)
// No step id: a new step, at the end of the top level or of the repeat in ?repeat=
const stepId = computed(() => (route.params.stepId as string | undefined) ?? undefined)
const repeatId = typeof route.query.repeat === 'string' ? route.query.repeat : null
const saving = ref(false)
const leave = useLeaveScreen(
  () => ({ name: 'session-edit', params: { id: programId.value, sid: sessionId.value } }),
  saving,
)

const TARGETS: { kind: TargetKind; label: string }[] = [
  { kind: 'none', label: 'None' },
  { kind: 'duration', label: 'Time' },
  { kind: 'distance', label: 'Distance' },
]

const blocks = ref<StepBlock[]>([])
const state = ref<'loading' | 'ready' | 'missing' | 'error'>('loading')
const error = ref<string | null>(null)
const confirming = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

const form = ref({
  kind: 'run' as StepKind,
  targetKind: 'none' as TargetKind,
  target: '',
  paceMin: '',
  paceMax: '',
  repetitions: 2,
})
// Where the step sits: inside a repeat (its id) or at the top level (null)
const parent = ref<string | null>(repeatId)
// The repeat's own steps, when this step is a repeat
const children = ref(0)

const isRepeat = computed(() => form.value.kind === 'repeat')
// A repeat can only be picked for a new top-level step; an existing repeat stays one
const lockedRepeat = computed(() => stepId.value !== undefined && isRepeat.value)
const kinds = computed(() =>
  STEP_KINDS.filter((k) => k !== 'repeat' || (stepId.value === undefined && parent.value === null)),
)
const lastInRepeat = computed(() => {
  if (!parent.value) return false
  return blocks.value.find((b) => b.step.id === parent.value)?.children.length === 1
})

useBackInterceptor(confirming, () => {
  if (!deleting.value) confirming.value = false
})

async function load() {
  state.value = 'loading'
  try {
    const session = sessionId.value === 'new' ? null : await training.getSession(sessionId.value)
    if (!session || session.programId !== programId.value) {
      state.value = 'missing'
      return
    }
    blocks.value = await training.loadBlocks(session.id)
    if (stepId.value) {
      const found = findStep(blocks.value, stepId.value)
      if (!found) {
        state.value = 'missing'
        return
      }
      const s = found.step
      parent.value = found.parent?.step.id ?? null
      children.value = found.children.length
      form.value = {
        kind: s.kind,
        targetKind: s.targetKind,
        target:
          s.targetValue === null
            ? ''
            : s.targetKind === 'duration'
              ? formatMinSec(s.targetValue)
              : String(Math.round(s.targetValue)),
        paceMin: s.paceMin === null ? '' : formatMinSec(s.paceMin),
        paceMax: s.paceMax === null ? '' : formatMinSec(s.paceMax),
        repetitions: s.repetitions ?? 2,
      }
    } else if (repeatId && !findStep(blocks.value, repeatId)) {
      state.value = 'missing'
      return
    }
    state.value = 'ready'
  } catch (err) {
    console.warn('[db] could not load step', err)
    state.value = 'error'
  }
}

/** The step from the form, or a message for the user */
function readForm(): Omit<SessionStep, 'id' | 'sessionId' | 'position'> | string {
  const f = form.value
  if (f.kind === 'repeat') {
    return {
      kind: 'repeat',
      targetKind: 'none',
      targetValue: null,
      paceMin: null,
      paceMax: null,
      repetitions: f.repetitions,
      span: null,
    }
  }
  let targetValue: number | null = null
  if (f.targetKind === 'duration') {
    targetValue = parseMinSec(f.target)
    if (targetValue === null) return 'Enter the time as min:s, for example 2:00.'
  } else if (f.targetKind === 'distance') {
    const metres = Number(f.target)
    if (!Number.isInteger(metres) || metres <= 0) return 'Enter the distance in whole metres.'
    targetValue = metres
  }
  const pace = (text: string) => (text.trim() === '' ? null : parseMinSec(text))
  const paceMin = pace(f.paceMin)
  const paceMax = pace(f.paceMax)
  if ((f.paceMin.trim() && paceMin === null) || (f.paceMax.trim() && paceMax === null)) {
    return 'Enter the pace as min:s per km, for example 5:30.'
  }
  return {
    kind: f.kind,
    targetKind: f.targetKind,
    targetValue,
    paceMin,
    paceMax,
    repetitions: null,
    span: null,
  }
}

function nextBlocks(fields: Omit<SessionStep, 'id' | 'sessionId' | 'position'>): StepBlock[] {
  const base = { sessionId: sessionId.value, position: 0 }
  if (stepId.value) return replaceStep(blocks.value, { ...fields, ...base, id: stepId.value })
  const step: SessionStep = { ...fields, ...base, id: crypto.randomUUID() }
  if (step.kind !== 'repeat') return addStep(blocks.value, step, parent.value)
  // A repeat can't be empty: it starts with one run without a target, to edit next
  const first: SessionStep = {
    ...base,
    id: crypto.randomUUID(),
    kind: 'run',
    targetKind: 'none',
    targetValue: null,
    paceMin: null,
    paceMax: null,
    repetitions: null,
    span: null,
  }
  return [...blocks.value, { step, children: [first] }]
}

async function save() {
  if (saving.value) return
  const fields = readForm()
  if (typeof fields === 'string') {
    error.value = fields
    return
  }
  saving.value = true
  error.value = null
  try {
    await training.saveBlocks(sessionId.value, nextBlocks(fields))
    leave()
  } catch (err) {
    if (!(err instanceof TrainingError)) console.warn('[db] could not save step', err)
    error.value = err instanceof TrainingError ? err.message : 'Could not save the step.'
  } finally {
    saving.value = false
  }
}

async function onDelete() {
  if (deleting.value || !stepId.value) return
  deleting.value = true
  deleteError.value = null
  try {
    await training.saveBlocks(sessionId.value, removeStep(blocks.value, stepId.value))
    confirming.value = false
    leave()
  } catch (err) {
    console.warn('[db] could not delete step', err)
    deleteError.value = err instanceof TrainingError ? err.message : 'Could not delete the step'
  } finally {
    deleting.value = false
  }
}

function changeRepetitions(by: number) {
  form.value.repetitions = Math.min(99, Math.max(1, form.value.repetitions + by))
}

onMounted(load)
</script>

<template>
  <main class="page">
    <header class="bar">
      <button class="back" :disabled="saving" @click="leave()">‹ Cancel</button>
      <button v-if="state === 'ready'" class="back" :disabled="saving" @click="save()">Save</button>
    </header>

    <p v-if="state === 'loading'" class="message">Loading…</p>

    <section v-else-if="state === 'missing'" class="message">
      <p>This step no longer exists</p>
      <button class="btn" @click="router.replace({ name: 'training' })">Back to Training</button>
    </section>

    <section v-else-if="state === 'error'" class="message">
      <p>Could not load the step</p>
      <button class="btn" @click="load()">Retry</button>
    </section>

    <template v-else>
      <h1>{{ stepId ? 'Edit step' : parent ? 'New step in repeat' : 'New step' }}</h1>
      <form class="form" @submit.prevent="save()">
        <span id="step-kind" class="label">Kind</span>
        <p v-if="lockedRepeat" class="stepper__value step-kind--locked">Repeat</p>
        <div v-else class="choices" role="group" aria-labelledby="step-kind">
          <button
            v-for="k in kinds"
            :key="k"
            type="button"
            class="btn"
            :aria-pressed="form.kind === k"
            :disabled="saving"
            @click="form.kind = k"
          >
            {{ STEP_KIND_LABELS[k] }}
          </button>
        </div>

        <template v-if="isRepeat">
          <span id="step-times" class="label">Times</span>
          <div class="stepper" role="group" aria-labelledby="step-times">
            <button
              type="button"
              class="btn"
              aria-label="Fewer times"
              :disabled="saving || form.repetitions <= 1"
              @click="changeRepetitions(-1)"
            >
              −
            </button>
            <span class="stepper__value" aria-live="polite">{{ form.repetitions }}×</span>
            <button
              type="button"
              class="btn"
              aria-label="More times"
              :disabled="saving || form.repetitions >= 99"
              @click="changeRepetitions(1)"
            >
              +
            </button>
          </div>
          <p class="hint">
            {{
              stepId
                ? `Repeats its ${children} ${children === 1 ? 'step' : 'steps'}.`
                : 'Starts with one run step; add more to it on the session screen.'
            }}
          </p>
        </template>

        <template v-else>
          <span id="step-target" class="label">Target</span>
          <div class="choices" role="group" aria-labelledby="step-target">
            <button
              v-for="t in TARGETS"
              :key="t.kind"
              type="button"
              class="btn"
              :aria-pressed="form.targetKind === t.kind"
              :disabled="saving"
              @click="form.targetKind = t.kind"
            >
              {{ t.label }}
            </button>
          </div>
          <template v-if="form.targetKind !== 'none'">
            <label class="label" for="step-target-value">
              {{ form.targetKind === 'duration' ? 'Time (min:s)' : 'Distance (m)' }}
            </label>
            <input
              id="step-target-value"
              v-model="form.target"
              class="input"
              type="text"
              :inputmode="form.targetKind === 'duration' ? 'text' : 'numeric'"
              :placeholder="form.targetKind === 'duration' ? '2:00' : '400'"
              :disabled="saving"
            />
          </template>

          <span id="step-pace" class="label">Pace (optional, min:s per km)</span>
          <div class="pace" role="group" aria-labelledby="step-pace">
            <input
              v-model="form.paceMin"
              class="input"
              type="text"
              aria-label="Fastest pace"
              placeholder="4:50"
              :disabled="saving"
            />
            <span aria-hidden="true">–</span>
            <input
              v-model="form.paceMax"
              class="input"
              type="text"
              aria-label="Slowest pace"
              placeholder="5:00"
              :disabled="saving"
            />
          </div>
        </template>

        <p v-if="error" class="field-error" role="alert">{{ error }}</p>

        <button type="submit" class="btn btn--primary" :disabled="saving">Save</button>
      </form>

      <button
        v-if="stepId"
        class="btn btn--danger btn--wide"
        :disabled="saving"
        @click="confirming = true"
      >
        Delete step
      </button>
    </template>

    <ConfirmDialog
      v-if="confirming"
      :title="lockedRepeat ? 'Delete this repeat?' : 'Delete this step?'"
      :busy="deleting"
      :error="deleteError"
      @keep="confirming = false"
      @confirm="onDelete()"
    >
      <template v-if="lockedRepeat">
        Its {{ children }} {{ children === 1 ? 'step goes' : 'steps go' }} too.
      </template>
      <template v-else-if="lastInRepeat"
        >It is the repeat's last step, so the repeat goes too.</template
      >
      <template v-else>It is removed from the session.</template>
    </ConfirmDialog>
  </main>
</template>

<style scoped src="./training.css"></style>
<style scoped>
.pace {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: #9aa5b1;
}

.step-kind--locked {
  margin: 0;
  text-align: left;
}
</style>
