import {
  BACKUP_FOOTER,
  backupFileName,
  backupHeader,
  backupRunPiece,
  parseBackup,
} from '@/lib/backup'
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

export type Progress = (done: number, total: number) => void

/** The pieces of a backup of all finished runs, oldest first, loading each run's points as it goes. */
export async function* backupPieces(
  runs: RunRecord[],
  source: BackupSource,
  now: number,
  onProgress?: Progress,
): AsyncGenerator<string> {
  yield backupHeader(now)
  let done = 0
  for (const run of [...runs].reverse()) {
    yield backupRunPiece({ run, points: await source.loadPoints(run.id) }, done)
    done++
    onProgress?.(done, runs.length)
  }
  yield BACKUP_FOOTER
}

/** Share a backup of all finished runs. Resolves with how many runs it holds (0: nothing to back up). */
export async function backUpRuns(
  source: BackupSource,
  now = Date.now(),
  onProgress?: Progress,
): Promise<number> {
  const runs = await source.listFinished()
  if (runs.length === 0) return 0
  await shareFile(
    backupFileName(now),
    backupPieces(runs, source, now, onProgress),
    'application/json',
  )
  return runs.length
}

/**
 * Add the runs of a backup file that this phone does not have. Throws `BackupError` before
 * writing anything when the file is unusable; a run that already exists is never overwritten.
 */
export async function restoreRuns(
  target: BackupTarget,
  text: string,
  onProgress?: Progress,
): Promise<RestoreResult> {
  const { runs, rejected } = parseBackup(text)
  let added = 0
  let skipped = 0
  for (const { run, points } of runs) {
    if (await target.importRun(run, points)) added++
    else skipped++
    onProgress?.(added + skipped, runs.length)
  }
  return { added, skipped, rejected }
}
