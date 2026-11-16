<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useBackInterceptor } from '@/composables/useBackButton'
import { followedProgramId } from '@/lib/settings'
import {
  nextSession,
  sessionTitle,
  type ProgramSession,
  type ProgramSummary,
  type SessionStep,
} from '@/lib/training'
import { useRunStore } from '@/stores/run'
import { useTrainingStore } from '@/stores/training'

/**
 * Pick a session of any program (#148): the run summary's "Link to a session" and the Run
 * screen's ⇄ both use it. It only reports the pick; the parent stores it. Mount it while open:
 * it loads on mount, and Back closes it while it is mounted.
 */
const props = defineProps<{
  title: string
  /** The parent is storing a pick: no closing or picking meanwhile */
  busy?: boolean
  /** The parent's own failure, shown under the list */
  error?: string | null
  /** The session the caller has now, marked in the list */
  selectedId?: string | null
}>()
const emit = defineEmits<{
  /** `isNext`: the followed program's next session, i.e. what is offered without a pick */
  pick: [sessionId: string, isNext: boolean]
  close: []
}>()

const run = useRunStore()
const training = useTrainingStore()

const programs = ref<ProgramSummary[]>([])
const programId = ref<string | null>(null)
const sessions = ref<ProgramSession[]>([])
// Steps of the chosen program's sessions, for their names; empty when they can't be read
const choiceSteps = ref<ReadonlyMap<string, SessionStep[]>>(new Map())
const doneIds = ref<ReadonlySet<string>>(new Set())
const skippedIds = ref<ReadonlySet<string>>(new Set())
const loading = ref(true)
const failed = ref(false)
const list = ref<HTMLElement | null>(null)

function close() {
  if (!props.busy) emit('close')
}
useBackInterceptor(ref(true), close)

/** The runnable sessions of the chosen program, by week then position (rest days can't be run) */
const choices = computed(() =>
  [...sessions.value]
    .sort((a, b) => a.week - b.week || a.position - b.position)
    .filter((s) => s.type !== 'rest'),
)

/** Where the list opens: the session this program would offer next */
const firstUp = computed(
  () => nextSession(sessions.value, doneIds.value, skippedIds.value)?.id ?? null,
)

/** The "Next" mark, only in the followed program: picking it means "no pick" */
const nextId = computed(() =>
  programId.value !== null && programId.value === followedProgramId.value ? firstUp.value : null,
)

onMounted(async () => {
  try {
    programs.value = await training.listPrograms()
    const followed = programs.value.find((p) => p.id === followedProgramId.value)
    programId.value = (followed ?? programs.value[0])?.id ?? null
    doneIds.value = new Set(await run.doneSessionIds())
    // Skips are a nicety, as in usePlannedSession: without them the list still works
    skippedIds.value = new Set(
      await training.skippedSessionIds().catch((err) => {
        console.warn('[db] could not read the skipped sessions', err)
        return []
      }),
    )
    await loadChoices()
  } catch (err) {
    console.warn('[db] could not list the sessions to pick', err)
    failed.value = true
  } finally {
    loading.value = false
  }
  await scrollToFirstUp()
})

async function loadChoices() {
  const id = programId.value
  sessions.value = id === null ? [] : await training.listSessions(id)
  choiceSteps.value = new Map()
  if (id === null) return
  try {
    choiceSteps.value = await training.loadProgramSteps(id)
  } catch (err) {
    // Sessions without a title then show their type
    console.warn('[db] could not read the steps for the session names', err)
  }
}

async function changeProgram() {
  failed.value = false
  try {
    await loadChoices()
  } catch (err) {
    console.warn('[db] could not list the sessions to pick', err)
    failed.value = true
  }
  await scrollToFirstUp()
}

async function scrollToFirstUp() {
  await nextTick()
  const id = firstUp.value
  if (id === null) return
  const item = list.value?.querySelector<HTMLElement>(`[data-session="${id}"]`)
  // jsdom has no scrollIntoView; the list then simply starts at the top
  item?.scrollIntoView?.({ block: 'center' })
}

function pick(id: string) {
  if (!props.busy) emit('pick', id, id === nextId.value)
}
</script>

<template>
  <div class="backdrop" @click.self="close()">
    <div class="dialog" role="dialog" aria-modal="true" :aria-label="title">
      <h2>{{ title }}</h2>
      <label v-if="programs.length > 1" class="field">
        <span>Program</span>
        <select v-model="programId" :disabled="busy" @change="changeProgram()">
          <option v-for="p in programs" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <p v-if="loading" class="hint">Loading…</p>
      <ul v-else ref="list" class="choices">
        <li v-for="s in choices" :key="s.id" :data-session="s.id">
          <button
            class="choice"
            :class="{ 'choice--selected': s.id === selectedId }"
            :aria-current="s.id === selectedId ? 'true' : undefined"
            :disabled="busy"
            @click="pick(s.id)"
          >
            <span class="choice__week">W{{ s.week }}</span>
            <span class="choice__title">{{ sessionTitle(s, choiceSteps.get(s.id) ?? []) }}</span>
            <span v-if="s.id === nextId" class="choice__mark choice__mark--next">Next</span>
            <span v-else-if="doneIds.has(s.id)" class="choice__done" aria-label="Done">✓</span>
            <span v-else-if="skippedIds.has(s.id)" class="choice__mark">Skipped</span>
          </button>
        </li>
        <li v-if="choices.length === 0" class="hint">This program has no sessions to run.</li>
      </ul>
      <p v-if="failed" class="notice" role="alert">Could not read the sessions.</p>
      <p v-if="error" class="notice" role="alert">{{ error }}</p>
      <button class="btn" :disabled="busy" @click="close()">Cancel</button>
    </div>
  </div>
</template>

<style scoped>
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

.hint {
  margin: 0;
  color: #9aa5b1;
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
  gap: 0.5rem;
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

.choice--selected {
  background: #26303a;
  border-radius: 0.5rem;
}

.choice__week,
.choice__mark {
  color: #9aa5b1;
}

.choice__mark {
  font-size: 0.9rem;
}

.choice__mark--next {
  color: #6fb3ff;
  font-weight: 700;
}

.choice__done {
  color: #6fcf97;
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
  margin: 0;
  color: #ffb3b3;
}
</style>
