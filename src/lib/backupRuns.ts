import {
  BACKUP_FOOTER,
  backupFileName,
  backupHeader,
  backupKey,
  backupRunPiece,
  parseBackup,
} from '@/lib/backup'
import type { RunRecord, StoredPoint } from '@/lib/db/runRepository'
import { reshareFile, shareFile } from '@/lib/shareRun'

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

/** A backup file already written to the cache, to share again while nothing has changed. */
export interface PreparedBackup {
  key: string
  fileName: string
  uri: string
}

export interface BackupOutcome {
  /** How many runs the backup holds (0: nothing to back up) */
  count: number
  prepared: PreparedBackup | null
}

/**
 * Share a backup of all finished runs. With the result of an earlier call and no change since,
 * the file written then is shared again instead of being built again.
 */
export async function backUpRuns(
  source: BackupSource,
  now = Date.now(),
  onProgress?: Progress,
  previous: PreparedBackup | null = null,
): Promise<BackupOutcome> {
  const runs = await source.listFinished()
  if (runs.length === 0) return { count: 0, prepared: null }
  const fileName = backupFileName(now)
  const key = backupKey(fileName, runs)
  if (previous?.key === key && (await reshareFile(fileName, previous.uri))) {
    return { count: runs.length, prepared: previous }
  }
  const uri = await shareFile(
    fileName,
    backupPieces(runs, source, now, onProgress),
    'application/json',
  )
  return { count: runs.length, prepared: uri === null ? null : { key, fileName, uri } }
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
