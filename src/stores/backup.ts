import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { BackupError } from '@/lib/backup'
import { backUpRuns, restoreRuns, type PreparedBackup } from '@/lib/backupRuns'
import { useRunStore } from '@/stores/run'

const runsText = (n: number) => (n === 1 ? '1 run' : `${n} runs`)

/**
 * Backup and restore of all runs. Lives in a store, not in the Settings screen: the work goes on
 * when the user switches tab, and a second start must be refused while one is running (two
 * backups would write the same cache file).
 */
export const useBackupStore = defineStore('backup', () => {
  const run = useRunStore()
  const busy = ref(false)
  const message = ref('')
  // null until counted, or when the database cannot be read
  const finishedCount = ref<number | null>(null)
  // The last backup file written; shared again, not rebuilt, while the runs are unchanged
  let prepared: PreparedBackup | null = null

  // A long restore would hold up the writes of a run in progress
  const runActive = computed(() => run.status === 'running' || run.status === 'paused')
  const blocked = computed(() => busy.value || runActive.value)

  async function countRuns() {
    try {
      finishedCount.value = (await run.listFinished()).length
    } catch {
      finishedCount.value = null
    }
  }

  async function backUp() {
    if (blocked.value) return
    busy.value = true
    message.value = ''
    try {
      const outcome = await backUpRuns(
        run,
        Date.now(),
        (done, total) => {
          message.value = `Backing up ${done} of ${total} runs…`
        },
        prepared,
      )
      prepared = outcome.prepared
      const count = outcome.count
      message.value = count === 0 ? 'No runs to back up' : `Backed up ${runsText(count)}`
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
      const { added, skipped, rejected } = await restoreRuns(
        run,
        await file.text(),
        (done, total) => {
          message.value = `Restoring ${done} of ${total} runs…`
        },
      )
      const parts = [`Restored ${runsText(added)}`]
      if (skipped > 0) parts.push(`${skipped} already on this phone`)
      if (rejected > 0) parts.push(`${rejected} damaged and left out`)
      message.value = parts.join(', ')
    } catch (err) {
      if (!(err instanceof BackupError)) console.warn('Restore failed', err)
      message.value =
        err instanceof BackupError ? err.message : 'Restore failed. Nothing was lost; try again.'
    } finally {
      busy.value = false
      await countRuns()
    }
  }

  return { busy, message, finishedCount, runActive, blocked, countRuns, backUp, restore }
})
