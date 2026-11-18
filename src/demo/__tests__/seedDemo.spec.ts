import { beforeEach, describe, expect, it } from 'vitest'
import text from '../demo-backup.json?raw'
import { seedDemoFrom, shiftToRecent } from '../seedDemo'
import { createMemoryRunRepository } from '@/lib/db/memoryRunRepository'
import { createMemoryTrainingRepository } from '@/lib/db/memoryTrainingRepository'
import { followedProgramId, setFollowedProgram } from '@/lib/settings'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 17, 12)

function repos() {
  const run = createMemoryRunRepository()
  const training = createMemoryTrainingRepository()
  return {
    run,
    training,
    target: {
      importRun: run.importRun,
      importProgram: training.importProgram,
    },
  }
}

describe('shiftToRecent', () => {
  const backup = () => ({
    exportedAt: Date.UTC(2026, 0, 1, 7),
    runs: [
      {
        run: { startedAt: Date.UTC(2025, 11, 31, 8), finishedAt: Date.UTC(2025, 11, 31, 9) },
        points: [{ timestamp: Date.UTC(2025, 11, 31, 8) }],
      },
      { run: { startedAt: Date.UTC(2025, 11, 28, 8), finishedAt: null }, points: [] },
    ],
    programs: [{ program: { startDate: '2025-12-18', createdAt: 0, updatedAt: 0 } }],
  })

  it('moves the newest run to about a day ago, by whole days', () => {
    const shifted = shiftToRecent(backup(), NOW)
    const newest = shifted.runs[0]!.run.startedAt
    expect(NOW - newest).toBeGreaterThanOrEqual(DAY / 2)
    expect(NOW - newest).toBeLessThanOrEqual(1.5 * DAY)
    // Same time of day, and the other times move by the same amount
    expect(new Date(newest).getUTCHours()).toBe(8)
    const delta = newest - Date.UTC(2025, 11, 31, 8)
    expect(delta % DAY).toBe(0)
    expect(shifted.runs[0]!.points[0]!.timestamp).toBe(newest)
    expect(shifted.runs[1]!.run.startedAt).toBe(Date.UTC(2025, 11, 28, 8) + delta)
    expect(shifted.runs[1]!.run.finishedAt).toBeNull()
    expect(shifted.programs[0]!.program.createdAt).toBe(delta)
  })

  it('moves the program start date by the same days', () => {
    const shifted = shiftToRecent(backup(), NOW)
    const days = (shifted.runs[0]!.run.startedAt - Date.UTC(2025, 11, 31, 8)) / DAY
    const expected = new Date(Date.UTC(2025, 11, 18) + days * DAY).toISOString().slice(0, 10)
    expect(shifted.programs[0]!.program.startDate).toBe(expected)
  })

  it('leaves a backup without runs as it is', () => {
    const empty = { exportedAt: 5, runs: [] }
    expect(shiftToRecent(empty, NOW)).toEqual({ exportedAt: 5, runs: [] })
  })
})

describe('seedDemoFrom with the committed demo file', () => {
  beforeEach(() => setFollowedProgram(null))

  it('adds every run and the program, recent, and follows the program', async () => {
    const { run, training, target } = repos()
    const result = await seedDemoFrom(target, text, NOW)

    expect(result).toMatchObject({ added: 12, skipped: 0, programsAdded: 1, rejected: 0 })
    const runs = await run.listFinished()
    expect(runs).toHaveLength(12)
    expect(NOW - runs[0]!.startedAt).toBeLessThanOrEqual(1.5 * DAY)
    expect(runs.every((r) => r.startedAt < NOW)).toBe(true)
    expect((await run.loadPoints(runs[0]!.id)).length).toBeGreaterThan(100)

    const programs = await training.listPrograms()
    expect(programs).toHaveLength(1)
    expect(followedProgramId.value).toBe(programs[0]!.id)
    expect(await training.listSessions(programs[0]!.id)).toHaveLength(12)
  })
})
