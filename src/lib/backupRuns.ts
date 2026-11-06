import {
  BACKUP_FOOTER,
  BACKUP_PROGRAMS_START,
  backupFileName,
  backupHeader,
  backupKey,
  backupProgramPiece,
  backupRunPiece,
  parseBackup,
} from '@/lib/backup'
import type { RunRecord, StoredPoint } from '@/lib/db/runRepository'
import type { ProgramBundle } from '@/lib/training'
import { reshareFile, shareFile } from '@/lib/shareRun'

/** Runs come from the run store, programs from the training store (see `stores/backup.ts`) */
export interface BackupSource {
  listFinished(): Promise<RunRecord[]>
  loadPoints(runId: string): Promise<StoredPoint[]>
  exportPrograms(): Promise<ProgramBundle[]>
}

export interface BackupTarget {
  importRun(run: RunRecord, points: StoredPoint[]): Promise<boolean>
  importProgram(bundle: ProgramBundle): Promise<boolean>
}

export interface RestoreResult {
  added: number
  /** Already on this phone, left as they are */
  skipped: number
  programsAdded: number
  programsSkipped: number
  /** Malformed runs and programs in the file, and programs that could not be stored */
  rejected: number
}

export type Progress = (done: number, total: number) => void

/**
 * The pieces of a backup of all finished runs, oldest first, loading each run's points as it
 * goes, then the programs. Progress counts runs only: the programs are small and already loaded.
 */
export async function* backupPieces(
  runs: RunRecord[],
  programs: ProgramBundle[],
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
  yield BACKUP_PROGRAMS_START
  for (const [i, bundle] of programs.entries()) yield backupProgramPiece(bundle, i)
  yield BACKUP_FOOTER
}

/** A backup file already written to the cache, to share again while nothing has changed. */
export interface PreparedBackup {
  key: string
  fileName: string
  uri: string
}

export interface BackupOutcome {
  /** How many runs and programs the backup holds (both 0: nothing to back up) */
  runs: number
  programs: number
  prepared: PreparedBackup | null
}

/**
 * Share a backup of all finished runs and all training programs. With the result of an earlier
 * call and no change since, the file written then is shared again instead of being built again.
 */
export async function backUpRuns(
  source: BackupSource,
  now = Date.now(),
  onProgress?: Progress,
  previous: PreparedBackup | null = null,
): Promise<BackupOutcome> {
  const runs = await source.listFinished()
  const programs = await source.exportPrograms()
  const counts = { runs: runs.length, programs: programs.length }
  if (runs.length === 0 && programs.length === 0) return { ...counts, prepared: null }
  const fileName = backupFileName(now)
  const key = backupKey(
    fileName,
    runs,
    programs.map((b) => b.program),
  )
  if (previous?.key === key && (await reshareFile(fileName, previous.uri))) {
    return { ...counts, prepared: previous }
  }
  const uri = await shareFile(
    fileName,
    backupPieces(runs, programs, source, now, onProgress),
    'application/json',
  )
  return { ...counts, prepared: uri === null ? null : { key, fileName, uri } }
}

/**
 * Add the runs and programs of a backup file that this phone does not have. Throws `BackupError`
 * before writing anything when the file is unusable; a run or program that already exists is
 * never overwritten. A program that fails to store (say, a hand-edited file reusing a session id
 * of another program) is counted as rejected and the rest goes on; a failing run still stops
 * the restore, as before.
 */
export async function restoreRuns(
  target: BackupTarget,
  text: string,
  onProgress?: Progress,
): Promise<RestoreResult> {
  const parsed = parseBackup(text)
  let { rejected } = parsed
  let added = 0
  let skipped = 0
  for (const { run, points } of parsed.runs) {
    if (await target.importRun(run, points)) added++
    else skipped++
    onProgress?.(added + skipped, parsed.runs.length)
  }
  let programsAdded = 0
  let programsSkipped = 0
  for (const bundle of parsed.programs) {
    try {
      if (await target.importProgram(bundle)) programsAdded++
      else programsSkipped++
    } catch (err) {
      console.warn('[backup] could not restore program', bundle.program.id, err)
      rejected++
    }
  }
  return { added, skipped, programsAdded, programsSkipped, rejected }
}
