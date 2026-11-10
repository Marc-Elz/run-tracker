import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRunStore } from '@/stores/run'
import { useTrainingStore } from '@/stores/training'
import {
  advanceSteps,
  expandSteps,
  nextStepByHand,
  stepProgress,
  type StepTotals,
  type TimelineStep,
} from '@/lib/stepProgress'

/**
 * Moves a session's steps on from the run totals while a run of that session is going (#101).
 * The logic is in `stepProgress.ts`; this only wires it to the stores. `progress` is null for a
 * free run, while the steps load, and when they can't be read: the run goes on without a panel.
 */
export function useSessionSteps() {
  const run = useRunStore()
  const training = useTrainingStore()
  const { status, sessionId, runSteps, elapsedMs, distanceM } = storeToRefs(run)
  const timeline = ref<TimelineStep[]>([])

  // Null again when the link could not be stored: a free run after all, so no steps are written
  watch(
    sessionId,
    async (id) => {
      timeline.value = []
      if (id === null) return
      try {
        const steps = await training.loadSteps(id)
        if (sessionId.value === id) timeline.value = expandSteps(steps)
      } catch (err) {
        console.warn('[db] could not load the steps of this session', err)
      }
    },
    { immediate: true },
  )

  const totals = computed<StepTotals>(() => ({
    elapsedMs: elapsedMs.value,
    distanceM: distanceM.value,
  }))

  // Only while running: a pause stops the step. The first tick after loading (or after Resume
  // on a recovered run) catches up through every step already due.
  watch([status, totals, timeline], () => {
    if (status.value !== 'running') return
    const change = advanceSteps(timeline.value, runSteps.value, totals.value)
    if (change) run.applyStepChange(change)
  })

  /** Next step on a step without a target */
  function nextStep() {
    if (status.value !== 'running') return
    const change = nextStepByHand(timeline.value, runSteps.value, totals.value)
    if (change) run.applyStepChange(change)
  }

  const progress = computed(() =>
    status.value === 'running' || status.value === 'paused'
      ? stepProgress(timeline.value, runSteps.value, totals.value)
      : null,
  )

  return { progress, nextStep }
}
