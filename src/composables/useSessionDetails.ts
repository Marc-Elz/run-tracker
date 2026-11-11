import { computed, ref, type Ref } from 'vue'
import type { RunRecord } from '@/lib/db/runRepository'
import type { ProgramSession, StepBlock } from '@/lib/training'
import { useRunStore } from '@/stores/run'
import { useTrainingStore } from '@/stores/training'

/**
 * One saved session as the session view shows it (#147): its steps, its runs, whether it is done
 * or skipped, and what can be done with it (run, skip, delete). Runs and skips that can't be read
 * only leave their parts out: the session itself still shows.
 */
export function useSessionDetails(programId: Ref<string>, sessionId: Ref<string>) {
  const training = useTrainingStore()
  const run = useRunStore()

  const state = ref<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const session = ref<ProgramSession | null>(null)
  const blocks = ref<StepBlock[]>([])
  // The finished runs linked to this session, newest first (#102)
  const runs = ref<RunRecord[]>([])
  // Has a finished run (#40); null until known, or when it could not be read
  const done = ref<boolean | null>(null)
  // Marked skipped (#102); null until known, or when it could not be read
  const skipped = ref<boolean | null>(null)
  const skipBusy = ref(false)
  const skipError = ref<string | null>(null)

  async function load() {
    state.value = 'loading'
    try {
      const found = await training.getSession(sessionId.value)
      if (!found || found.programId !== programId.value) {
        state.value = 'missing'
        return
      }
      session.value = found
      blocks.value = await training.loadBlocks(found.id)
      try {
        runs.value = (await run.listFinished()).filter((r) => r.sessionId === found.id)
        done.value = runs.value.length > 0
      } catch (err) {
        console.warn('[db] could not tell whether this session was run', err)
      }
      try {
        skipped.value = (await training.skippedSessionIds()).includes(found.id)
      } catch (err) {
        console.warn('[db] could not tell whether this session was skipped', err)
      }
      state.value = 'ready'
    } catch (err) {
      console.warn('[db] could not load session', err)
      state.value = 'error'
    }
  }

  const isRest = computed(() => session.value?.type === 'rest')

  // "Run this session" or, once it has a finished run, "Run again" (#116): not on a rest day
  const canRun = computed(() => session.value !== null && !isRest.value && run.status === 'idle')

  // "Skip this session": not a rest day and no run yet. A run still makes it done, so skipping
  // never blocks running it. A skip stays undoable after a run, so it can't come back unseen if
  // that run is deleted.
  const canSkip = computed(
    () =>
      session.value !== null &&
      !isRest.value &&
      (done.value === false || skipped.value === true) &&
      skipped.value !== null,
  )

  async function toggleSkip() {
    if (!canSkip.value || skipBusy.value) return
    skipBusy.value = true
    skipError.value = null
    try {
      const next = !skipped.value
      await training.setSkipped(sessionId.value, next)
      skipped.value = next
    } catch (err) {
      console.warn('[db] could not change the skip', err)
      skipError.value = 'Could not change the skip'
    } finally {
      skipBusy.value = false
    }
  }

  return {
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
  }
}
