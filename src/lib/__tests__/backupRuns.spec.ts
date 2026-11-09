import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BackupError, buildBackup } from '../backup'
import { createMemoryRunRepository } from '../db/memoryRunRepository'
import { createMemoryTrainingRepository } from '../db/memoryTrainingRepository'
import type { RunRecord } from '../db/runRepository'
import type { TrainingProgram } from '../training'

// The share functions stand in: shareFile reads the pieces like the real one and keeps the joined text
const share = vi.hoisted(() => {
  const shared = { name: '', text: '', mime: '', pieces: 0, fileGone: false }
  return {
    shared,
    reshareFile: vi.fn<(name: string, uri: string) => Promise<boolean>>(
      async () => !shared.fileGone,
    ),
    shareFile: vi.fn<
      (name: string, content: string | AsyncIterable<string>, mime: string) => Promise<string | null>
    >(async (name, content, mime) => {
      shared.name = name
      shared.mime = mime
      shared.text = ''
      shared.pieces = 0
      if (typeof content === 'string') shared.text = content
      else {
        for await (const piece of content) {
          shared.text += piece
          shared.pieces++
        }
      }
      return `file:///cache/${name}`
    }),
  }
})
vi.mock('../shareRun', () => ({ shareFile: share.shareFile, reshareFile: share.reshareFile }))

const { backUpRuns, restoreRuns } = await import('../backupRuns')

const finished = (id: string, startedAt: number): RunRecord => ({
  id,
  name: null,
  status: 'finished',
  startedAt,
  finishedAt: startedAt + 10,
  elapsedMs: 10,
  segment: 0,
  segmentStartedAt: null,
  movingMs: 10,
  distanceM: 5,
  sessionId: null,
})
const point = (timestamp: number) => ({ segment: 0, timestamp, lat: 1, lon: 2 })

/** Runs and programs as one source and target, like `stores/backup.ts` builds from its stores */
function repos() {
  const run = createMemoryRunRepository()
  const training = createMemoryTrainingRepository()
  return Object.assign(run, {
    training,
    listPrograms: () => training.listPrograms(),
    exportPrograms: () => training.exportPrograms(),
    importProgram: training.importProgram,
  })
}

describe('backup and restore of runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    share.shared.fileGone = false
  })

  it('backs up finished runs only, oldest first, with their points', async () => {
    const repo = repos()
    await repo.importRun(finished('new', 20), [point(21)])
    await repo.importRun(finished('old', 10), [point(11), point(12)])
    await repo.createRun({ ...finished('live', 30), status: 'running', finishedAt: null })
    expect((await backUpRuns(repo, 0)).runs).toBe(2)
    const ids = (JSON.parse(share.shared.text).runs as { run: RunRecord; points: unknown[] }[]).map(
      (r) => [r.run.id, r.points.length],
    )
    expect(ids).toEqual([
      ['old', 2],
      ['new', 1],
    ])
  })

  it('hands the file over in pieces, one per run, and reports progress', async () => {
    const repo = repos()
    for (let i = 0; i < 3; i++) await repo.importRun(finished(`r${i}`, i), [point(i)])
    const seen: [number, number][] = []
    await backUpRuns(repo, 0, (done, total) => seen.push([done, total]))
    expect(share.shared.pieces).toBe(6) // header, 3 runs, start of programs, footer
    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
    expect(JSON.parse(share.shared.text).runs).toHaveLength(3)
  })

  it('shares the file with a dated name and reports the count, or 0 without runs', async () => {
    const repo = repos()
    expect((await backUpRuns(repo, 0)).runs).toBe(0)
    expect(share.shareFile).not.toHaveBeenCalled()
    await repo.importRun(finished('a', 1), [])
    expect((await backUpRuns(repo, new Date(2026, 9, 28).getTime())).runs).toBe(1)
    expect(share.shared.name).toBe('run-tracker-backup-2026-10-28.json')
    expect(share.shared.mime).toBe('application/json')
  })

  describe('sharing the same backup again', () => {
    const day = new Date(2026, 9, 28, 12).getTime()
    const setup = async () => {
      const repo = repos()
      await repo.importRun(finished('a', 1), [point(1)])
      await repo.importRun(finished('b', 2), [point(2)])
      return repo
    }

    it('shares the file written before instead of building it again while nothing changed', async () => {
      const repo = await setup()
      const first = await backUpRuns(repo, day)
      expect(first.prepared).toMatchObject({ fileName: 'run-tracker-backup-2026-10-28.json' })
      const second = await backUpRuns(repo, day + 60_000, undefined, first.prepared)
      expect(share.shareFile).toHaveBeenCalledOnce()
      expect(share.reshareFile).toHaveBeenCalledWith(
        'run-tracker-backup-2026-10-28.json',
        first.prepared!.uri,
      )
      expect(second).toEqual({ runs: 2, programs: 0, prepared: first.prepared })
    })

    it('builds it again after a run was added, deleted or renamed, or on another day', async () => {
      const repo = await setup()
      let prepared = (await backUpRuns(repo, day)).prepared
      await repo.importRun(finished('c', 3), [])
      prepared = (await backUpRuns(repo, day, undefined, prepared)).prepared
      expect(share.shareFile).toHaveBeenCalledTimes(2)

      await repo.renameRun('a', 'Haren')
      prepared = (await backUpRuns(repo, day, undefined, prepared)).prepared
      expect(share.shareFile).toHaveBeenCalledTimes(3)

      await repo.deleteRun('c')
      prepared = (await backUpRuns(repo, day, undefined, prepared)).prepared
      expect(share.shareFile).toHaveBeenCalledTimes(4)

      await backUpRuns(repo, day + 86_400_000, undefined, prepared)
      expect(share.shareFile).toHaveBeenCalledTimes(5)
      expect(share.reshareFile).not.toHaveBeenCalled()
    })

    it('builds it again when the cached file is gone', async () => {
      const repo = await setup()
      const first = await backUpRuns(repo, day)
      share.shared.fileGone = true
      const second = await backUpRuns(repo, day, undefined, first.prepared)
      expect(share.reshareFile).toHaveBeenCalledOnce()
      expect(share.shareFile).toHaveBeenCalledTimes(2)
      expect(second.runs).toBe(2)
    })
  })

  it('restores into an empty repository exactly as it was, and a second restore adds nothing', async () => {
    const source = repos()
    await source.importRun({ ...finished('a', 1), name: 'Haren' }, [point(5), point(5), point(2)])
    await backUpRuns(source, 0)
    const text = share.shared.text

    const target = repos()
    const seen: [number, number][] = []
    expect(await restoreRuns(target, text, (done, total) => seen.push([done, total]))).toEqual({
      added: 1,
      skipped: 0,
      programsAdded: 0,
      programsSkipped: 0,
      rejected: 0,
    })
    expect(seen).toEqual([[1, 1]])
    expect(await target.getRun('a')).toEqual(await source.getRun('a'))
    expect(await target.loadPoints('a')).toEqual(await source.loadPoints('a'))
    expect(await restoreRuns(target, text)).toMatchObject({ added: 0, skipped: 1, rejected: 0 })
    expect(await target.listFinished()).toHaveLength(1)
  })

  it('keeps the first of two runs with the same id in one file', async () => {
    const target = repos()
    const text = buildBackup(
      [
        { run: { ...finished('a', 1), name: 'first' }, points: [] },
        { run: { ...finished('a', 1), name: 'second' }, points: [] },
      ],
      [],
      0,
    )
    expect(await restoreRuns(target, text)).toMatchObject({ added: 1, skipped: 1, rejected: 0 })
    expect((await target.getRun('a'))?.name).toBe('first')
  })

  it('writes nothing when the file is unusable', async () => {
    const target = repos()
    await expect(restoreRuns(target, 'nope')).rejects.toThrow(BackupError)
    expect(await target.listFinished()).toEqual([])
  })

  describe('training programs', () => {
    const program = (id: string): TrainingProgram => ({
      id,
      name: 'Half',
      goal: null,
      weeks: 4,
      startDate: null,
      createdAt: 1,
      updatedAt: 1,
    })
    const session = (id: string, programId: string) => ({
      id,
      programId,
      week: 1,
      position: 0,
      type: 'easy' as const,
      title: 'Easy',
      notes: null,
    })

    it('backs up programs when there are no runs at all', async () => {
      const store = repos()
      await store.training.createProgram(program('p'))
      expect(await backUpRuns(store, 0)).toMatchObject({ runs: 0, programs: 1 })
      expect(JSON.parse(share.shared.text).programs[0].program.id).toBe('p')
    })

    it('builds it again after a session or a step was edited', async () => {
      const day = new Date(2026, 9, 28, 12).getTime()
      const store = repos()
      await store.training.createProgram(program('p'))
      await store.training.saveSession(session('s', 'p'))
      let prepared = (await backUpRuns(store, day)).prepared
      await backUpRuns(store, day, undefined, prepared)
      expect(share.shareFile).toHaveBeenCalledTimes(1)

      await store.training.saveSession({ ...session('s', 'p'), notes: 'Hilly' })
      prepared = (await backUpRuns(store, day, undefined, prepared)).prepared
      expect(share.shareFile).toHaveBeenCalledTimes(2)

      await store.training.replaceSteps('s', [
        {
          id: 'x',
          sessionId: 's',
          position: 0,
          kind: 'cooldown',
          targetKind: 'none',
          targetValue: null,
          paceMin: null,
          paceMax: null,
          repetitions: null,
          span: null,
        },
      ])
      await backUpRuns(store, day, undefined, prepared)
      expect(share.shareFile).toHaveBeenCalledTimes(3)
    })

    it('restores programs next to runs, and skips the ones already on this phone', async () => {
      const source = repos()
      await source.importRun(finished('a', 1), [])
      await source.training.createProgram(program('p'))
      await source.training.saveSession(session('s', 'p'))
      await backUpRuns(source, 0)
      const text = share.shared.text

      const target = repos()
      expect(await restoreRuns(target, text)).toEqual({
        added: 1,
        skipped: 0,
        programsAdded: 1,
        programsSkipped: 0,
        rejected: 0,
      })
      expect(await target.training.exportPrograms()).toEqual(await source.training.exportPrograms())
      expect(await restoreRuns(target, text)).toMatchObject({
        programsAdded: 0,
        programsSkipped: 1,
      })
    })

    it('restores programs before runs, so a run finds its session, and keeps the link (#40)', async () => {
      const source = repos()
      await source.training.createProgram(program('p'))
      await source.training.saveSession(session('s', 'p'))
      await source.importRun({ ...finished('a', 1), sessionId: 's' }, [])
      await backUpRuns(source, 0)

      const target = repos()
      const order: string[] = []
      const importRun = target.importRun
      const importProgram = target.importProgram
      target.importRun = (run, points) => (order.push('run'), importRun(run, points))
      target.importProgram = (bundle) => (order.push('program'), importProgram(bundle))
      await restoreRuns(target, share.shared.text)
      expect(order).toEqual(['program', 'run'])
      expect(await target.doneSessionIds()).toEqual(['s'])
    })

    it('counts a program whose ids clash with another one here as rejected, and restores the rest', async () => {
      const target = repos()
      await target.training.createProgram(program('mine'))
      await target.training.saveSession(session('s', 'mine'))
      const programs = [
        // Hand-edited: a new program reusing the id of a session already on this phone
        { program: program('clash'), sessions: [session('s', 'clash')], steps: [] },
        { program: program('good'), sessions: [], steps: [] },
      ]
      const result = await restoreRuns(target, buildBackup([], programs, 0))
      expect(result).toMatchObject({ programsAdded: 1, rejected: 1 })
      expect(await target.training.getProgram('good')).not.toBeNull()
      expect(await target.training.getProgram('clash')).toBeNull()
      expect((await target.training.getSession('s'))!.programId).toBe('mine')
    })

    it('stops on a storage failure instead of calling the file damaged', async () => {
      const target = repos()
      target.importProgram = async () => {
        throw new Error('disk full')
      }
      const programs = [{ program: program('p'), sessions: [], steps: [] }]
      await expect(restoreRuns(target, buildBackup([], programs, 0))).rejects.toThrow('disk full')
    })

    it('decides whether to share the last file again without reading the sessions', async () => {
      const store = repos()
      await store.training.createProgram(program('p'))
      const first = await backUpRuns(store, 0)
      let exported = 0
      const exportPrograms = store.exportPrograms
      store.exportPrograms = () => {
        exported++
        return exportPrograms()
      }
      await backUpRuns(store, 0, undefined, first.prepared)
      expect(exported).toBe(0)
      expect(share.reshareFile).toHaveBeenCalledOnce()
    })
  })
})
