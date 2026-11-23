import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useRunStore } from '../run'
import { createMemoryRunRepository } from '@/lib/db/memoryRunRepository'
import type { RunRecord, RunRepository } from '@/lib/db/runRepository'
import type { RunStep } from '@/lib/stepProgress'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 23, 12)

/** 10 min over 1 km: 10:00 /km */
const walk: RunStep = {
  position: 0,
  kind: 'walk',
  targetKind: 'duration',
  targetValue: 600,
  paceMin: null,
  paceMax: null,
  repetition: null,
  repetitions: null,
  startedElapsedMs: 0,
  startedDistanceM: 0,
  endedElapsedMs: 600_000,
  endedDistanceM: 1000,
}

function record(id: string, daysAgo: number, sessionId: string | null): RunRecord {
  const startedAt = NOW - daysAgo * DAY
  return {
    id,
    name: null,
    status: 'finished',
    startedAt,
    finishedAt: startedAt + 600_000,
    elapsedMs: 600_000,
    segment: 0,
    segmentStartedAt: null,
    movingMs: 600_000,
    distanceM: 1000,
    sessionId,
  }
}

describe('walk runs for the walk pace suggestion (#153)', () => {
  let repo: RunRepository

  beforeEach(() => {
    setActivePinia(createPinia())
    repo = createMemoryRunRepository()
  })

  function store() {
    const run = useRunStore()
    run.useRepository(repo)
    return run
  }

  it('reads run_steps of every recent run, also one whose session was deleted', async () => {
    await repo.importRun(record('linked', 1, 's1'), [], [walk])
    await repo.importRun(record('unlinked', 2, null), [], [walk]) // session deleted since
    await repo.importRun(record('free', 3, null), []) // a free run has no steps
    await repo.importRun(record('old', 50, 's1'), [], [walk])
    const runs = await store().loadRecentWalkRuns(NOW - 42 * DAY)
    expect(runs.map((r) => r.startedAt)).toEqual([NOW - DAY, NOW - 2 * DAY])
  })

  it('stops reading once it has 5 walks', async () => {
    for (let i = 1; i <= 8; i++) await repo.importRun(record(`r${i}`, i, 's1'), [], [walk])
    const loadRunSteps = vi.spyOn(repo, 'loadRunSteps')
    const runs = await store().loadRecentWalkRuns(NOW - 42 * DAY)
    expect(runs).toHaveLength(5)
    expect(loadRunSteps).toHaveBeenCalledTimes(5)
  })

  it('suggests a pace from them', async () => {
    await repo.importRun(record('a', 1, 's1'), [], [walk])
    await repo.importRun(record('b', 2, 's1'), [], [walk])
    expect(await store().loadWalkSuggestion(NOW)).toEqual({
      pace: 630,
      runs: 2,
      since: NOW - 2 * DAY,
    })
  })
})
