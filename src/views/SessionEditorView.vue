<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useBackInterceptor } from '@/composables/useBackButton'
import { useLeaveScreen } from '@/composables/useLeaveScreen'
import { useTrainingStore } from '@/stores/training'
import {
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  SESSION_TYPE_LABELS,
  SESSION_TYPES,
  TrainingError,
  type SessionInput,
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
const weeks = ref(1)
const state = ref<'loading' | 'ready' | 'missing' | 'error'>('loading')
const error = ref<string | null>(null)
const confirming = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

useBackInterceptor(confirming, () => {
  if (!deleting.value) confirming.value = false
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

async function save() {
  if (saving.value) return
  saving.value = true
  error.value = null
  try {
    await training.saveSession(programId.value, form.value, sessionId.value)
    leave()
  } catch (err) {
    if (!(err instanceof TrainingError)) console.warn('[db] could not save session', err)
    error.value = err instanceof TrainingError ? err.message : 'Could not save the session.'
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
            @click="form.type = t"
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
  </main>
</template>

<style scoped src="./training.css"></style>
