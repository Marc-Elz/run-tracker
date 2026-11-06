import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { BackupError } from '@/lib/backup'
import {
  backUpRuns,
  restoreRuns,
  type BackupSource,
  type BackupTarget,
  type PreparedBackup,
} from '@/lib/backupRuns'
import { useRunStore } from '@/stores/run'
import { useTrainingStore } from '@/stores/training'

const runsText = (n: number) => (n === 1 ? '1 run' : `${n} runs`)
const programsText = (n: number) => (n === 1 ? '1 program' : `${n} programs`)

/** "3 runs", "3 runs and 1 program" or "1 program"; with neither it says "0 runs" */
const itemsText = (runs: number, programs: number) =>
  programs === 0
    ? runsText(runs)
    : runs === 0
      ? programsText(programs)
      : `${runsText(runs)} and ${programsText(programs)}`

/**
 * Backup and restore of all runs and training programs. Lives in a store, not in the Settings screen: the work goes on
 * when the user switches tab, and a second start must be refused while one is running (two
 * backups would write the same cache file).
 */
export const useBackupStore = defineStore('backup', () => {
  const run = useRunStore()
  const training = useTrainingStore()
  // Runs from the run store, programs from the training store, as one source and target
  const store: BackupSource & BackupTarget = {
    listFinished: () => run.listFinished(),
    loadPoints: (runId) => run.loadPoints(runId),
    importRun: (r, points) => run.importRun(r, points),
    exportPrograms: () => training.exportPrograms(),
    importProgram: (bundle) => training.importProgram(bundle),
  }
  const busy = ref(false)
  const message = ref('')
  // null until counted, or when the database cannot be read
  const finishedCount = ref<number | null>(null)
  const programCount = ref<number | null>(null)
  const nothingToBackUp = computed(() => finishedCount.value === 0 && programCount.value === 0)
  // The last backup file written; shared again, not rebuilt, while the runs are unchanged
  let prepared: PreparedBackup | null = null

  // A long restore would hold up the writes of a run in progress
  const runActive = computed(() => run.status === 'running' || run.status === 'paused')
  const blocked = computed(() => busy.value || runActive.value)

  async function countItems() {
    try {
      finishedCount.value = (await run.listFinished()).length
    } catch {
      finishedCount.value = null
    }
    try {
      programCount.value = (await training.listPrograms()).length
    } catch {
      programCount.value = null
    }
  }

  async function backUp() {
    if (blocked.value) return
    busy.value = true
    message.value = ''
    try {
      const outcome = await backUpRuns(
        store,
        Date.now(),
        (done, total) => {
          message.value = `Backing up ${done} of ${total} runs…`
        },
        prepared,
      )
      prepared = outcome.prepared
      message.value =
        outcome.runs === 0 && outcome.programs === 0
          ? 'Nothing to back up'
          : `Backed up ${itemsText(outcome.runs, outcome.programs)}`
    } catch (err) {
      console.warn('Backup failed', err)
      message.value = 'Backup failed. Try again.'
    } finally {
      busy.value = false
    }
  }

  async function restore(file: File) {
    if (blocked.value) return
    busy.value = true
    message.value = 'Reading the file…'
    try {
      const { added, skipped, programsAdded, programsSkipped, rejected } = await restoreRuns(
        store,
        await file.text(),
        (done, total) => {
          message.value = `Restoring ${done} of ${total} runs…`
        },
      )
      const parts = [`Restored ${itemsText(added, programsAdded)}`]
      if (skipped + programsSkipped > 0) {
        parts.push(`${skipped + programsSkipped} already on this phone`)
      }
      if (rejected > 0) parts.push(`${rejected} damaged and left out`)
      message.value = parts.join(', ')
    } catch (err) {
      if (!(err instanceof BackupError)) console.warn('Restore failed', err)
      message.value =
        err instanceof BackupError ? err.message : 'Restore failed. Nothing was lost; try again.'
    } finally {
      busy.value = false
      await countItems()
    }
  }

  return {
    busy,
    message,
    finishedCount,
    programCount,
    nothingToBackUp,
    runActive,
    blocked,
    countItems,
    backUp,
    restore,
  }
})
