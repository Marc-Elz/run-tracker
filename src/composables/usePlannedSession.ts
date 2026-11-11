import { ref, watch, type Ref } from 'vue'
import { followedProgramId } from '@/lib/settings'
import {
  isRunnable,
  nextSession,
  sessionTitle,
  type ProgramSession,
  type TrainingProgram,
} from '@/lib/training'
import { useRunStore } from '@/stores/run'
import { useTrainingStore } from '@/stores/training'

/**
 * What the Run screen offers to start (#40): a session picked with "Run this session", else the
 * next session of the followed program. `session` is null when that program is complete.
 */
export interface PlannedSession {
  program: TrainingProgram
  session: ProgramSession | null
  /** The session's name, typed or made from its steps (#143); empty without a session */
  title: string
  /** Picked from the session editor rather than being the next one */
  chosen: boolean
}

/**
 * `planned` is null while loading, when nothing is followed, or when the training data can't be
 * read: a free run must always stay possible, so a failure only leaves the card out.
 * `following` tells "nothing followed" (show the hint) apart from those other cases.
 */
export function usePlannedSession(requested: Ref<string | null>) {
  const run = useRunStore()
  const training = useTrainingStore()
  const planned = ref<PlannedSession | null>(null)
  const following = ref(true)
  let latest = 0

  /** The session's name; without its steps it falls back to the type, never fails the card */
  async function titleOf(session: ProgramSession | null): Promise<string> {
    if (!session) return ''
    const steps = await training.loadSteps(session.id).catch((err) => {
      console.warn('[db] could not read the steps for the session name', err)
      return []
    })
    return sessionTitle(session, steps)
  }

  async function find(): Promise<PlannedSession | null> {
    const done = new Set(await run.doneSessionIds())
    if (requested.value !== null) {
      const session = await training.getSession(requested.value)
      // A picked session may already be done: "Run again" (#116). Only a rest day can't be run.
      if (session && isRunnable(session, new Set())) {
        const program = await training.getProgram(session.programId)
        if (program) return { program, session, title: await titleOf(session), chosen: true }
      }
    }
    const id = followedProgramId.value
    if (id === null) return null
    const program = await training.getProgram(id)
    if (!program) return null
    // Skips are a nicety: if they can't be read, the next session is picked without them
    const skipped = new Set(
      await training.skippedSessionIds().catch((err) => {
        console.warn('[db] could not read the skipped sessions', err)
        return []
      }),
    )
    const session = nextSession(await training.listSessions(id), done, skipped)
    return { program, session, title: await titleOf(session), chosen: false }
  }

  async function reload() {
    const call = ++latest
    planned.value = null
    try {
      const found = await find()
      if (call !== latest) return
      planned.value = found
      // A followed program that no longer exists counts as nothing followed
      following.value = found !== null
    } catch (err) {
      console.warn('[db] could not load the next session', err)
    }
  }

  watch([requested, followedProgramId], reload, { immediate: true })
  return { planned, following, reload }
}
