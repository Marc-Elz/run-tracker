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
import type { RunStep } from '@/lib/stepProgress'
import type { ProgramBundle, TrainingProgram } from '@/lib/training'
import type { ImportOutcome } from '@/lib/db/trainingRepository'
import { reshareFile, shareFile } from '@/lib/shareRun'

/** Runs come from the run store, programs from the training store (see `stores/backup.ts`) */
export interface BackupSource {
  listFinished(): Promise<RunRecord[]>
  loadPoints(runId: string): Promise<StoredPoint[]>
  loadRunSteps(runId: string): Promise<RunStep[]>
  /** Enough to decide whether the last file can be shared again */
  listPrograms(): Promise<TrainingProgram[]>
  /** Everything inside the programs, read only when a new file is built */
  exportPrograms(): Promise<ProgramBundle[]>
}

export interface BackupTarget {
  importRun(run: RunRecord, points: StoredPoint[], steps: RunStep[]): Promise<boolean>
  importProgram(bundle: ProgramBundle): Promise<ImportOutcome>
}

export interface RestoreResult {
  added: number
  /** Already on this phone, left as they are */
  skipped: number
  programsAdded: number
  programsSkipped: number
  /** Malformed runs and programs in the file, and programs whose ids clash with others here */
  rejected: number
}

export type Progress = (done: number, total: number) => void

/**
 * The pieces of a backup of all finished runs, oldest first, loading each run's points as it
 * goes, then the programs. Progress counts runs only: the programs are small.
 */
export async function* backupPieces(
  runs: RunRecord[],
  source: BackupSource,
  now: number,
  onProgress?: Progress,
): AsyncGenerator<string> {
  yield backupHeader(now)
  let done = 0
  for (const run of [...runs].reverse()) {
    const points = await source.loadPoints(run.id)
    const steps = await source.loadRunSteps(run.id)
    yield backupRunPiece({ run, points, steps }, done)
    done++
    onProgress?.(done, runs.length)
  }
  yield BACKUP_PROGRAMS_START
  for (const [i, bundle] of (await source.exportPrograms()).entries()) {
    yield backupProgramPiece(bundle, i)
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
  const programs = await source.listPrograms()
  const counts = { runs: runs.length, programs: programs.length }
  if (runs.length === 0 && programs.length === 0) return { ...counts, prepared: null }
  const fileName = backupFileName(now)
  const key = backupKey(fileName, runs, programs)
  if (previous?.key === key && (await reshareFile(fileName, previous.uri))) {
    return { ...counts, prepared: previous }
  }
  const uri = await shareFile(
    fileName,
    backupPieces(runs, source, now, onProgress),
    'application/json',
  )
  return { ...counts, prepared: uri === null ? null : { key, fileName, uri } }
}

/**
 * Add the runs and programs of a backup file that this phone does not have. Throws `BackupError`
 * before writing anything when the file is unusable; a run or program that already exists is
 * never overwritten. A program whose session or step ids belong to something else on this phone
 * (only possible with a hand-edited file) is counted as rejected and the rest goes on. A storage
 * failure stops the restore, for programs as for runs, so it is reported as a failure and not as
 * a damaged file. A run keeps its session link only when that session is on the phone and has
 * no run yet.
 */
export async function restoreRuns(
  target: BackupTarget,
  text: string,
  onProgress?: Progress,
): Promise<RestoreResult> {
  const parsed = parseBackup(text)
  let { rejected } = parsed
  // Programs first, so the session a run is linked to is there when the run comes in
  let programsAdded = 0
  let programsSkipped = 0
  for (const bundle of parsed.programs) {
    const outcome = await target.importProgram(bundle)
    if (outcome === 'added') programsAdded++
    else if (outcome === 'exists') programsSkipped++
    else rejected++
  }
  let added = 0
  let skipped = 0
  for (const { run, points, steps = [] } of parsed.runs) {
    if (await target.importRun(run, points, steps)) added++
    else skipped++
    onProgress?.(added + skipped, parsed.runs.length)
  }
  return { added, skipped, programsAdded, programsSkipped, rejected }
}
