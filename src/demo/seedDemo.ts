import { restoreRuns, type BackupTarget } from '@/lib/backupRuns'
import { setFollowedProgram } from '@/lib/settings'

/**
 * Sample data for the web demo on GitHub Pages (#162), built only with VITE_DEMO=true. The seed
 * file is a normal backup (`scripts/make-test-backup.mjs --demo`), so it goes in through the same
 * restore as a backup on the phone. Its times are fixed, so they are moved to just before today
 * first: otherwise History would show runs from months ago.
 */

const DAY = 86_400_000

/** The parts of a backup file whose times are moved; everything else is kept as it is */
interface DemoBackup {
  exportedAt: number
  runs: {
    run: { startedAt: number; finishedAt: number | null }
    points: { timestamp: number }[]
  }[]
  programs?: {
    program: { startDate: string | null; createdAt: number; updatedAt: number }
  }[]
}

/**
 * Moves every time in the backup by whole days so that the newest run starts about a day before
 * `now` (between 12 and 36 hours ago). Whole days keep each run's time of day.
 */
export function shiftToRecent<T extends DemoBackup>(backup: T, now: number): T {
  const newest = Math.max(...backup.runs.map((r) => r.run.startedAt))
  if (!Number.isFinite(newest)) return backup
  const delta = Math.round((now - DAY - newest) / DAY) * DAY
  backup.exportedAt += delta
  for (const { run, points } of backup.runs) {
    run.startedAt += delta
    if (run.finishedAt !== null) run.finishedAt += delta
    for (const point of points) point.timestamp += delta
  }
  for (const { program } of backup.programs ?? []) {
    program.createdAt += delta
    program.updatedAt += delta
    if (program.startDate !== null) {
      program.startDate = new Date(Date.parse(`${program.startDate}T00:00:00Z`) + delta)
        .toISOString()
        .slice(0, 10)
    }
  }
  return backup
}

/**
 * Stores the sample runs and program and follows the program, so the Run screen shows its next
 * session. The followed program is kept in localStorage but programs are not, so after a reload
 * it can only be this one or one that is gone. Returns what the restore added.
 */
export async function seedDemoFrom(target: BackupTarget, text: string, now = Date.now()) {
  const parsed = JSON.parse(text) as DemoBackup & { programs?: { program: { id: string } }[] }
  const backup = shiftToRecent(parsed, now)
  const result = await restoreRuns(target, JSON.stringify(backup))
  const program = backup.programs?.[0]?.program.id
  if (program) setFollowedProgram(program)
  return result
}

/** Loads the seed file (a chunk of its own, only in the demo build) and stores it */
export async function seedDemo(target: BackupTarget) {
  const { default: text } = await import('./demo-backup.json?raw')
  return seedDemoFrom(target, text)
}
