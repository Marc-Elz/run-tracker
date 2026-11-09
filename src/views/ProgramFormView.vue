<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useBackInterceptor } from '@/composables/useBackButton'
import { useLeaveScreen } from '@/composables/useLeaveScreen'
import { useTrainingStore } from '@/stores/training'
import { useRunStore } from '@/stores/run'
import { MAX_NAME_LENGTH, MAX_WEEKS, TrainingError, type ProgramInput } from '@/lib/training'

const route = useRoute()
const router = useRouter()
const training = useTrainingStore()
const run = useRunStore()

// No id: a new program
const id = computed(() => (route.params.id as string | undefined) ?? null)
const saving = ref(false)
// Android back waits for a save in flight, which leaves the screen itself when it succeeds
const leave = useLeaveScreen(
  () => (id.value ? { name: 'program', params: { id: id.value } } : { name: 'training' }),
  saving,
)

const form = ref<ProgramInput>({ name: '', goal: null, weeks: 8, startDate: null })
const sessionCount = ref(0)
// Runs done for this program's sessions; null when they could not be counted
const runCount = ref<number | null>(null)
const state = ref<'loading' | 'ready' | 'missing' | 'error'>(id.value ? 'loading' : 'ready')
const error = ref<string | null>(null)
const confirming = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

useBackInterceptor(confirming, () => {
  if (!deleting.value) confirming.value = false
})

async function load() {
  if (!id.value) return
  state.value = 'loading'
  try {
    const program = await training.getProgram(id.value)
    if (!program) {
      state.value = 'missing'
      return
    }
    const { name, goal, weeks, startDate } = program
    form.value = { name, goal, weeks, startDate }
    const sessions = await training.listSessions(id.value)
    sessionCount.value = sessions.length
    state.value = 'ready'
    await countRuns(sessions.map((s) => s.id))
  } catch (err) {
    console.warn('[db] could not load program', err)
    state.value = 'error'
  }
}

/** The runs are only named in the delete confirmation, so failing here costs nothing else */
async function countRuns(sessionIds: string[]) {
  try {
    const done = new Set(await run.doneSessionIds())
    runCount.value = sessionIds.filter((s) => done.has(s)).length
  } catch (err) {
    console.warn('[db] could not count the runs of this program', err)
    runCount.value = null
  }
}

function changeWeeks(by: number) {
  form.value.weeks = Math.min(MAX_WEEKS, Math.max(1, form.value.weeks + by))
}

async function save() {
  if (saving.value) return
  saving.value = true
  error.value = null
  try {
    // An emptied date input gives "", which means no start date
    const input = { ...form.value, startDate: form.value.startDate || null }
    if (id.value) {
      await training.updateProgram(id.value, input)
      leave()
    } else {
      const newId = await training.createProgram(input)
      await router.replace({ name: 'program', params: { id: newId } })
    }
  } catch (err) {
    if (!(err instanceof TrainingError)) console.warn('[db] could not save program', err)
    error.value = err instanceof TrainingError ? err.message : 'Could not save the program.'
  } finally {
    saving.value = false
  }
}

async function onDelete() {
  if (deleting.value || !id.value) return
  deleting.value = true
  deleteError.value = null
  try {
    await training.deleteProgram(id.value)
    confirming.value = false
    await router.replace({ name: 'training' })
  } catch (err) {
    console.warn('[db] could not delete program', err)
    deleteError.value = 'Could not delete the program'
  } finally {
    deleting.value = false
  }
}

const sessionsText = computed(() =>
  sessionCount.value === 1
    ? 'Its 1 session goes too.'
    : `Its ${sessionCount.value} sessions go too.`,
)

// Every done session has exactly one run (#40)
const runsText = computed(() => {
  const n = runCount.value
  if (n === null || n === 0) return 'Your runs are kept.'
  return n === 1 ? 'The run you did for it is kept.' : `The ${n} runs you did for it are kept.`
})

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
      <p>This program no longer exists</p>
      <button class="btn" @click="router.replace({ name: 'training' })">Back to Training</button>
    </section>

    <section v-else-if="state === 'error'" class="message">
      <p>Could not load the program</p>
      <button class="btn" @click="load()">Retry</button>
    </section>

    <template v-else>
      <h1>{{ id ? 'Edit program' : 'New program' }}</h1>
      <form class="form" @submit.prevent="save()">
        <label class="label" for="program-name">Name</label>
        <input
          id="program-name"
          v-model="form.name"
          class="input"
          type="text"
          placeholder="Half marathon"
          :maxlength="MAX_NAME_LENGTH"
          :disabled="saving"
        />

        <label class="label" for="program-goal">Goal (optional)</label>
        <input
          id="program-goal"
          v-model="form.goal"
          class="input"
          type="text"
          placeholder="Sub 2:00"
          :maxlength="MAX_NAME_LENGTH"
          :disabled="saving"
        />

        <span id="program-weeks" class="label">Weeks</span>
        <div class="stepper" role="group" aria-labelledby="program-weeks">
          <button
            type="button"
            class="btn"
            aria-label="One week less"
            :disabled="saving || form.weeks <= 1"
            @click="changeWeeks(-1)"
          >
            −
          </button>
          <span class="stepper__value" aria-live="polite">{{ form.weeks }}</span>
          <button
            type="button"
            class="btn"
            aria-label="One week more"
            :disabled="saving || form.weeks >= MAX_WEEKS"
            @click="changeWeeks(1)"
          >
            +
          </button>
        </div>

        <label class="label" for="program-start">Start date (optional)</label>
        <input
          id="program-start"
          v-model="form.startDate"
          class="input"
          type="date"
          :disabled="saving"
        />
        <p class="hint">Only used to show which week you are in.</p>

        <p v-if="error" class="field-error" role="alert">{{ error }}</p>

        <button type="submit" class="btn btn--primary" :disabled="saving">Save</button>
      </form>

      <button
        v-if="id"
        class="btn btn--danger btn--wide"
        :disabled="saving"
        @click="confirming = true"
      >
        Delete program
      </button>
    </template>

    <ConfirmDialog
      v-if="confirming"
      :title="`Delete ${form.name}?`"
      :busy="deleting"
      :error="deleteError"
      @keep="confirming = false"
      @confirm="onDelete()"
    >
      {{ sessionsText }} {{ runsText }}
    </ConfirmDialog>
  </main>
</template>

<style scoped src="./training.css"></style>
