<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useBackInterceptor } from '@/composables/useBackButton'
import { useLeaveScreen } from '@/composables/useLeaveScreen'
import { useSessionDetails } from '@/composables/useSessionDetails'
import { useTrainingStore } from '@/stores/training'
import { formatDistanceKm, formatDuration, formatRunDate } from '@/lib/format'
import { SESSION_TYPE_LABELS, stepSummary } from '@/lib/training'

/**
 * A session at a glance (#147): what it is, a button to run it, its steps and its runs. Changing
 * it happens in the session editor, behind Edit.
 */
const route = useRoute()
const router = useRouter()
const training = useTrainingStore()

const programId = computed(() => route.params.id as string)
const sessionId = computed(() => route.params.sid as string)
const deleting = ref(false)
const leave = useLeaveScreen(() => ({ name: 'program', params: { id: programId.value } }), deleting)

const {
  state,
  session,
  blocks,
  runs,
  done,
  skipped,
  skipBusy,
  skipError,
  isRest,
  canRun,
  canSkip,
  load,
  toggleSkip,
} = useSessionDetails(programId, sessionId)

const confirming = ref(false)
const deleteError = ref<string | null>(null)
useBackInterceptor(confirming, () => {
  if (!deleting.value) confirming.value = false
})

/** To the Run screen with this session ready to start */
function runSession() {
  if (!canRun.value) return
  void router.push({ name: 'run', query: { session: sessionId.value } })
}

async function onDelete() {
  if (deleting.value) return
  deleting.value = true
  deleteError.value = null
  try {
    await training.deleteSession(sessionId.value)
    confirming.value = false
    deleting.value = false
    leave()
  } catch (err) {
    console.warn('[db] could not delete session', err)
    deleteError.value = 'Could not delete the session'
    deleting.value = false
  }
}

onMounted(load)
</script>

<template>
  <main class="page">
    <header class="bar">
      <button class="back" :disabled="deleting" @click="leave()">‹ Back</button>
      <RouterLink
        v-if="state === 'ready'"
        class="back edit"
        :to="{ name: 'session-edit', params: { id: programId, sid: sessionId } }"
      >
        Edit
      </RouterLink>
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

    <template v-else-if="session">
      <h1 class="title">{{ session.title }}</h1>
      <p class="subtitle">{{ SESSION_TYPE_LABELS[session.type] }} · Week {{ session.week }}</p>
      <p v-if="done" class="done">✓ Done</p>

      <div v-if="canRun || canSkip" class="actions">
        <button v-if="canRun" class="btn btn--primary actions__run" @click="runSession()">
          {{ done ? 'Run again' : 'Run this session' }}
        </button>
        <button
          v-if="canSkip"
          class="btn btn--quiet actions__skip"
          :disabled="skipBusy"
          :aria-pressed="skipped === true"
          @click="toggleSkip()"
        >
          {{ skipped ? 'Undo skip' : 'Skip' }}
        </button>
      </div>
      <p v-if="canSkip && skipped && !done" class="hint aside">
        Skipped: "Start next session" passes over it.
      </p>
      <p v-if="skipError" class="field-error aside" role="alert">{{ skipError }}</p>

      <section v-if="session.notes" class="steps" aria-labelledby="notes-title">
        <h2 id="notes-title" class="steps__title">Notes</h2>
        <p class="notes">{{ session.notes }}</p>
      </section>

      <section v-if="!isRest" class="steps" aria-labelledby="steps-title">
        <h2 id="steps-title" class="steps__title">Steps</h2>
        <ol v-if="blocks.length > 0" class="step-list">
          <li
            v-for="b in blocks"
            :key="b.step.id"
            class="step"
            :class="{ 'step--repeat': b.step.kind === 'repeat' }"
          >
            <div class="step__row step__row--view">
              <span class="step__text">{{ stepSummary(b.step, b.children.length) }}</span>
            </div>
            <ol v-if="b.step.kind === 'repeat'" class="step-list step-list--inner">
              <li v-for="c in b.children" :key="c.id" class="step">
                <div class="step__row step__row--view">
                  <span class="step__text">{{ stepSummary(c) }}</span>
                </div>
              </li>
            </ol>
          </li>
        </ol>
        <p v-else class="hint">No steps yet.</p>
      </section>

      <section v-if="runs.length > 0" class="runs" aria-labelledby="runs-title">
        <h2 id="runs-title" class="steps__title runs__title">Runs</h2>
        <ul class="list">
          <li v-for="r in runs" :key="r.id">
            <RouterLink class="row" :to="{ name: 'run-summary', params: { id: r.id } }">
              <span class="row__main">
                <span class="row__title">{{ formatRunDate(r.startedAt) }}</span>
                <span class="row__detail">
                  {{ formatDistanceKm(r.distanceM) }} km · {{ formatDuration(r.elapsedMs) }}
                </span>
              </span>
              <span class="row__chevron" aria-hidden="true">›</span>
            </RouterLink>
          </li>
        </ul>
      </section>

      <button class="btn btn--danger btn--wide" :disabled="deleting" @click="confirming = true">
        Delete session
      </button>
    </template>

    <ConfirmDialog
      v-if="confirming && session"
      title="Delete this session?"
      :busy="deleting"
      :error="deleteError"
      @keep="confirming = false"
      @confirm="onDelete()"
    >
      {{ session.title || 'It' }} is removed from week {{ session.week }}.
      <template v-if="done">Your run for it is kept.</template>
    </ConfirmDialog>
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
  white-space: normal;
}

.subtitle {
  margin: 0 1.5rem;
  color: #9aa5b1;
}

/* Run and Skip side by side: Run takes the room, Skip stays a big enough target */
.actions {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 1.5rem 0;
}

.actions__run {
  flex: 1;
}

.actions__skip {
  min-width: 6.5rem;
  margin-top: 0;
}

.aside {
  margin: 0.5rem 1.5rem 0;
}

.notes {
  margin: 0;
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.step__row--view {
  align-items: center;
  padding: 0 1rem;
}

.runs {
  margin-top: 1.5rem;
}

.runs__title {
  margin-bottom: 0.5rem;
  padding: 0 1.5rem;
}
</style>
