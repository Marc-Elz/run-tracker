import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BackupError, buildBackup } from '../backup'
import { createMemoryRunRepository } from '../db/memoryRunRepository'
import type { RunRecord } from '../db/runRepository'

// The share function stands in: it reads the pieces like the real one and keeps the joined text
const share = vi.hoisted(() => {
  const shared = { name: '', text: '', mime: '', pieces: 0 }
  return {
    shared,
    shareFile: vi.fn<(name: string, content: string | AsyncIterable<string>, mime: string) => Promise<void>>(async (name, content, mime) => {
      shared.name = name
      shared.mime = mime
      shared.text = ''
      shared.pieces = 0
      if (typeof content === 'string') {
        shared.text = content
        return
      }
      for await (const piece of content) {
        shared.text += piece
        shared.pieces++
      }
    }),
  }
})
vi.mock('../shareRun', () => ({ shareFile: share.shareFile }))

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
  beforeEach(() => vi.clearAllMocks())

  it('backs up finished runs only, oldest first, with their points', async () => {
    const repo = createMemoryRunRepository()
    await repo.importRun(finished('new', 20), [point(21)])
    await repo.importRun(finished('old', 10), [point(11), point(12)])
    await repo.createRun({ ...finished('live', 30), status: 'running', finishedAt: null })
    expect(await backUpRuns(repo, 0)).toBe(2)
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
    expect(await backUpRuns(repo, 0)).toBe(0)
    expect(share.shareFile).not.toHaveBeenCalled()
    await repo.importRun(finished('a', 1), [])
    expect(await backUpRuns(repo, new Date(2026, 9, 28).getTime())).toBe(1)
    expect(share.shared.name).toBe('run-tracker-backup-2026-10-28.json')
    expect(share.shared.mime).toBe('application/json')
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
