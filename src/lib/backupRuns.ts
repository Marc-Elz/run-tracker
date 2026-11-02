import { backupFileName, buildBackup, parseBackup, type BackupRun } from '@/lib/backup'
import type { RunRecord, StoredPoint } from '@/lib/db/runRepository'
import { shareFile } from '@/lib/shareRun'

export interface BackupSource {
  listFinished(): Promise<RunRecord[]>
  loadPoints(runId: string): Promise<StoredPoint[]>
}

export interface BackupTarget {
  importRun(run: RunRecord, points: StoredPoint[]): Promise<boolean>
}

export interface RestoreResult {
  added: number
  /** Already on this phone, left as they are */
  skipped: number
  /** Malformed runs in the file */
  rejected: number
}

/** Every finished run with all its points, oldest first, as the file text. Null when there is none. */
export async function buildBackupText(
  source: BackupSource,
  now: number,
): Promise<{ text: string; count: number } | null> {
  const finished = await source.listFinished()
  if (finished.length === 0) return null
  const runs: BackupRun[] = []
  for (const run of [...finished].reverse()) {
    runs.push({ run, points: await source.loadPoints(run.id) })
  }
  return { text: buildBackup(runs, now), count: runs.length }
}

/** Share a backup of all finished runs. Resolves with how many runs it holds (0: nothing to back up). */
export async function backUpRuns(source: BackupSource, now = Date.now()): Promise<number> {
  const backup = await buildBackupText(source, now)
  if (backup === null) return 0
  await shareFile(backupFileName(now), backup.text, 'application/json')
  return backup.count
}

/**
 * Add the runs of a backup file that this phone does not have. Throws `BackupError` before
 * writing anything when the file is unusable; a run that already exists is never overwritten.
 */
export async function restoreRuns(target: BackupTarget, text: string): Promise<RestoreResult> {
  const { runs, rejected } = parseBackup(text)
  let added = 0
  let skipped = 0
  for (const { run, points } of runs) {
    if (await target.importRun(run, points)) added++
    else skipped++
  }
  return { added, skipped, rejected }
}
