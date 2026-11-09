<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useBackInterceptor } from '@/composables/useBackButton'
import { useLeaveScreen } from '@/composables/useLeaveScreen'
import { useSortableSteps } from '@/composables/useSortableSteps'
import { useTrainingStore } from '@/stores/training'
import {
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  moveStep,
  SESSION_TYPE_LABELS,
  SESSION_TYPES,
  stepSummary,
  TrainingError,
  type SessionInput,
  type SessionType,
  type StepBlock,
  type StepPlace,
} from '@/lib/training'

const route = useRoute()
const router = useRouter()
const training = useTrainingStore()

const programId = computed(() => route.params.id as string)
// No session id: a new session
const sessionId = computed(() => (route.params.sid as string | undefined) ?? undefined)
const saving = ref(false)
// Android back waits for a save in flight, which leaves the screen itself when it succeeds
const leave = useLeaveScreen(() => ({ name: 'program', params: { id: programId.value } }), saving)

const requestedWeek = Number(route.query.week)
const form = ref<SessionInput>({
  week: Number.isInteger(requestedWeek) && requestedWeek >= 1 ? requestedWeek : 1,
  type: 'easy',
  title: '',
  notes: null,
})
// The session as stored: the step list follows the stored type, and unsaved changes lock it
const stored = ref<SessionInput | null>(null)
const weeks = ref(1)
const state = ref<'loading' | 'ready' | 'missing' | 'error'>('loading')
const error = ref<string | null>(null)
const confirming = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)
const confirmingRest = ref(false)

const blocks = ref<StepBlock[]>([])
const stepsRoot = ref<HTMLElement | null>(null)
const stepsBusy = ref(false)
const stepError = ref<string | null>(null)

const stepCount = computed(() => blocks.value.reduce((n, b) => n + 1 + b.children.length, 0))
const dirty = computed(() => {
  const s = stored.value
  if (!s) return false
  const f = form.value
  return (
    f.week !== s.week ||
    f.type !== s.type ||
    f.title.trim() !== s.title ||
    (f.notes?.trim() || null) !== s.notes
  )
})
const showSteps = computed(() => stored.value !== null && stored.value.type !== 'rest')
const stepsLocked = computed(() => dirty.value || saving.value || stepsBusy.value)

useBackInterceptor(confirming, () => {
  if (!deleting.value) confirming.value = false
})
useBackInterceptor(confirmingRest, () => {
  if (!saving.value) confirmingRest.value = false
})

useSortableSteps(stepsRoot, {
  enabled: computed(() => !stepsLocked.value),
  canMove: (from, to, isRepeat) => {
    if (isRepeat && to !== null) return false
    if (from !== null && from !== to) {
      const repeat = blocks.value.find((b) => b.step.id === from)
      if (repeat && repeat.children.length <= 1) return false
    }
    return true
  },
  onDrop: (from, to) => dropStep(from, to),
})

async function load() {
  state.value = 'loading'
  try {
    const program = await training.getProgram(programId.value)
    const session = sessionId.value ? await training.getSession(sessionId.value) : null
    if (!program || (sessionId.value && (!session || session.programId !== program.id))) {
      state.value = 'missing'
      return
    }
    weeks.value = program.weeks
    if (session) {
      const { week, type, title, notes } = session
      form.value = { week, type, title, notes }
      stored.value = { week, type, title, notes }
      blocks.value = await training.loadBlocks(session.id)
    } else {
      form.value.week = Math.min(form.value.week, program.weeks)
    }
    state.value = 'ready'
  } catch (err) {
    console.warn('[db] could not load session', err)
    state.value = 'error'
  }
}

function changeWeek(by: number) {
  form.value.week = Math.min(weeks.value, Math.max(1, form.value.week + by))
}

function pickType(t: SessionType) {
  form.value.type = t
}

function save() {
  if (saving.value) return
  // A rest day has no steps: say so before they go (the repository drops them in the same write)
  if (form.value.type === 'rest' && showSteps.value && stepCount.value > 0) {
    confirmingRest.value = true
    return
  }
  void store()
}

async function store() {
  if (saving.value) return
  saving.value = true
  error.value = null
  try {
    await training.saveSession(programId.value, form.value, sessionId.value)
    confirmingRest.value = false
    leave()
  } catch (err) {
    if (!(err instanceof TrainingError)) console.warn('[db] could not save session', err)
    error.value = err instanceof TrainingError ? err.message : 'Could not save the session.'
    confirmingRest.value = false
  } finally {
    saving.value = false
  }
}

async function onDelete() {
  if (deleting.value || !sessionId.value) return
  deleting.value = true
  deleteError.value = null
  try {
    await training.deleteSession(sessionId.value)
    confirming.value = false
    leave()
  } catch (err) {
    console.warn('[db] could not delete session', err)
    deleteError.value = 'Could not delete the session'
  } finally {
    deleting.value = false
  }
}

async function dropStep(from: StepPlace, to: StepPlace) {
  const sid = sessionId.value
  const next = moveStep(blocks.value, from, to)
  if (!sid || !next || stepsLocked.value) return
  const previous = blocks.value
  blocks.value = next
  stepsBusy.value = true
  stepError.value = null
  try {
    await training.saveBlocks(sid, next)
  } catch (err) {
    if (!(err instanceof TrainingError)) console.warn('[db] could not save steps', err)
    stepError.value = err instanceof TrainingError ? err.message : 'Could not save the new order.'
    // Show what is really stored
    blocks.value = await training.loadBlocks(sid).catch(() => previous)
  } finally {
    stepsBusy.value = false
  }
}

function openStep(stepId?: string, repeat?: string) {
  if (stepsLocked.value || !sessionId.value) return
  const params = { id: programId.value, sid: sessionId.value }
  if (stepId) void router.push({ name: 'step-edit', params: { ...params, stepId } })
  else void router.push({ name: 'step-new', params, query: repeat ? { repeat } : {} })
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
      <p>This session no longer exists</p>
      <button class="btn" @click="router.replace({ name: 'training' })">Back to Training</button>
    </section>

    <section v-else-if="state === 'error'" class="message">
      <p>Could not load the session</p>
      <button class="btn" @click="load()">Retry</button>
    </section>

    <template v-else>
      <h1>{{ sessionId ? 'Edit session' : 'New session' }}</h1>
      <form class="form" @submit.prevent="save()">
        <span id="session-week" class="label">Week</span>
        <div class="stepper" role="group" aria-labelledby="session-week">
          <button
            type="button"
            class="btn"
            aria-label="Week before"
            :disabled="saving || form.week <= 1"
            @click="changeWeek(-1)"
          >
            −
          </button>
          <span class="stepper__value" aria-live="polite">{{ form.week }}</span>
          <button
            type="button"
            class="btn"
            aria-label="Week after"
            :disabled="saving || form.week >= weeks"
            @click="changeWeek(1)"
          >
            +
          </button>
        </div>

        <span id="session-type" class="label">Type</span>
        <div class="choices" role="group" aria-labelledby="session-type">
          <button
            v-for="t in SESSION_TYPES"
            :key="t"
            type="button"
            class="btn"
            :aria-pressed="form.type === t"
            :disabled="saving"
            @click="pickType(t)"
          >
            {{ SESSION_TYPE_LABELS[t] }}
          </button>
        </div>

        <label class="label" for="session-title">Title</label>
        <input
          id="session-title"
          v-model="form.title"
          class="input"
          type="text"
          :placeholder="form.type === 'rest' ? 'Rest' : '6×400 m'"
          :maxlength="MAX_NAME_LENGTH"
          :disabled="saving"
        />

        <label class="label" for="session-notes">Notes (optional)</label>
        <textarea
          id="session-notes"
          v-model="form.notes"
          class="input"
          :maxlength="MAX_NOTES_LENGTH"
          :disabled="saving"
        ></textarea>

        <p v-if="error" class="field-error" role="alert">{{ error }}</p>

        <button type="submit" class="btn btn--primary" :disabled="saving">Save</button>
      </form>

      <section v-if="!sessionId" class="steps">
        <h2 class="steps__title">Steps</h2>
        <p class="hint">Save the session to add steps.</p>
      </section>

      <section
        v-else-if="showSteps"
        ref="stepsRoot"
        class="steps"
        :class="{ 'steps--locked': stepsLocked }"
        aria-labelledby="steps-title"
      >
        <h2 id="steps-title" class="steps__title">Steps</h2>
        <p class="hint">
          {{
            dirty ? 'Save your changes first to edit steps.' : 'Steps are saved as you change them.'
          }}
        </p>
        <p v-if="stepError" class="field-error" role="alert">{{ stepError }}</p>

        <ol class="step-list" data-step-list="">
          <li
            v-for="b in blocks"
            :key="b.step.id"
            class="step"
            :class="{ 'step--repeat': b.step.kind === 'repeat' }"
            :data-repeat="b.step.kind === 'repeat' ? '' : undefined"
          >
            <div class="step__row">
              <span class="step__handle" aria-hidden="true">≡</span>
              <button
                type="button"
                class="step__main"
                :disabled="stepsLocked"
                @click="openStep(b.step.id)"
              >
                <span class="step__text">{{ stepSummary(b.step, b.children.length) }}</span>
                <span class="row__chevron" aria-hidden="true">›</span>
              </button>
            </div>
            <template v-if="b.step.kind === 'repeat'">
              <ol class="step-list step-list--inner" :data-step-list="b.step.id">
                <li v-for="c in b.children" :key="c.id" class="step">
                  <div class="step__row">
                    <span class="step__handle" aria-hidden="true">≡</span>
                    <button
                      type="button"
                      class="step__main"
                      :disabled="stepsLocked"
                      @click="openStep(c.id)"
                    >
                      <span class="step__text">{{ stepSummary(c) }}</span>
                      <span class="row__chevron" aria-hidden="true">›</span>
                    </button>
                  </div>
                </li>
              </ol>
              <button
                type="button"
                class="btn btn--quiet step__add"
                :disabled="stepsLocked"
                @click="openStep(undefined, b.step.id)"
              >
                + Add step to repeat
              </button>
            </template>
          </li>
        </ol>
        <p v-if="blocks.length === 0" class="hint">No steps yet.</p>
        <button type="button" class="btn btn--quiet" :disabled="stepsLocked" @click="openStep()">
          + Add step
        </button>
      </section>

      <button
        v-if="sessionId"
        class="btn btn--danger btn--wide"
        :disabled="saving"
        @click="confirming = true"
      >
        Delete session
      </button>
    </template>

    <ConfirmDialog
      v-if="confirming"
      title="Delete this session?"
      :busy="deleting"
      :error="deleteError"
      @keep="confirming = false"
      @confirm="onDelete()"
    >
      {{ form.title || 'It' }} is removed from week {{ form.week }}.
    </ConfirmDialog>

    <ConfirmDialog
      v-if="confirmingRest"
      title="Make this a rest day?"
      confirm-label="Make rest day"
      :busy="saving"
      @keep="confirmingRest = false"
      @confirm="store()"
    >
      Its {{ stepCount }} {{ stepCount === 1 ? 'step goes' : 'steps go' }} too.
    </ConfirmDialog>
  </main>
</template>

<style scoped src="./training.css"></style>
