import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BackupError, buildBackup } from '../backup'
import { createMemoryRunRepository } from '../db/memoryRunRepository'
import type { RunRecord } from '../db/runRepository'

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
})
const point = (timestamp: number) => ({ segment: 0, timestamp, lat: 1, lon: 2 })

describe('backup and restore of runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    share.shared.fileGone = false
  })

  it('backs up finished runs only, oldest first, with their points', async () => {
    const repo = createMemoryRunRepository()
    await repo.importRun(finished('new', 20), [point(21)])
    await repo.importRun(finished('old', 10), [point(11), point(12)])
    await repo.createRun({ ...finished('live', 30), status: 'running', finishedAt: null })
    expect((await backUpRuns(repo, 0)).count).toBe(2)
    const ids = (JSON.parse(share.shared.text).runs as { run: RunRecord; points: unknown[] }[]).map(
      (r) => [r.run.id, r.points.length],
    )
    expect(ids).toEqual([
      ['old', 2],
      ['new', 1],
    ])
  })

  it('hands the file over in pieces, one per run, and reports progress', async () => {
    const repo = createMemoryRunRepository()
    for (let i = 0; i < 3; i++) await repo.importRun(finished(`r${i}`, i), [point(i)])
    const seen: [number, number][] = []
    await backUpRuns(repo, 0, (done, total) => seen.push([done, total]))
    expect(share.shared.pieces).toBe(5) // header, 3 runs, footer
    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
    expect(JSON.parse(share.shared.text).runs).toHaveLength(3)
  })

  it('shares the file with a dated name and reports the count, or 0 without runs', async () => {
    const repo = createMemoryRunRepository()
    expect((await backUpRuns(repo, 0)).count).toBe(0)
    expect(share.shareFile).not.toHaveBeenCalled()
    await repo.importRun(finished('a', 1), [])
    expect((await backUpRuns(repo, new Date(2026, 9, 28).getTime())).count).toBe(1)
    expect(share.shared.name).toBe('run-tracker-backup-2026-10-28.json')
    expect(share.shared.mime).toBe('application/json')
  })

  describe('sharing the same backup again', () => {
    const day = new Date(2026, 9, 28, 12).getTime()
    const setup = async () => {
      const repo = createMemoryRunRepository()
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
      expect(second).toEqual({ count: 2, prepared: first.prepared })
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
      expect(second.count).toBe(2)
    })
  })

  it('restores into an empty repository exactly as it was, and a second restore adds nothing', async () => {
    const source = createMemoryRunRepository()
    await source.importRun({ ...finished('a', 1), name: 'Haren' }, [point(5), point(5), point(2)])
    await backUpRuns(source, 0)
    const text = share.shared.text

    const target = createMemoryRunRepository()
    const seen: [number, number][] = []
    expect(await restoreRuns(target, text, (done, total) => seen.push([done, total]))).toEqual({
      added: 1,
      skipped: 0,
      rejected: 0,
    })
    expect(seen).toEqual([[1, 1]])
    expect(await target.getRun('a')).toEqual(await source.getRun('a'))
    expect(await target.loadPoints('a')).toEqual(await source.loadPoints('a'))
    expect(await restoreRuns(target, text)).toEqual({ added: 0, skipped: 1, rejected: 0 })
    expect(await target.listFinished()).toHaveLength(1)
  })

  it('keeps the first of two runs with the same id in one file', async () => {
    const target = createMemoryRunRepository()
    const text = buildBackup(
      [
        { run: { ...finished('a', 1), name: 'first' }, points: [] },
        { run: { ...finished('a', 1), name: 'second' }, points: [] },
      ],
      0,
    )
    expect(await restoreRuns(target, text)).toEqual({ added: 1, skipped: 1, rejected: 0 })
    expect((await target.getRun('a'))?.name).toBe('first')
  })

  it('writes nothing when the file is unusable', async () => {
    const target = createMemoryRunRepository()
    await expect(restoreRuns(target, 'nope')).rejects.toThrow(BackupError)
    expect(await target.listFinished()).toEqual([])
  })
})
