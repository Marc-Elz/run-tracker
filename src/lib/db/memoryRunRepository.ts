import type { RunRecord, RunRepository, StoredPoint } from './runRepository'

/** Keeps runs in memory: used in the browser and in unit tests. */
export function createMemoryRunRepository(): RunRepository {
  const runs = new Map<string, RunRecord>()
  const points = new Map<string, StoredPoint[]>()

  return {
    async createRun(run) {
      if (runs.has(run.id)) throw new Error(`Run ${run.id} already exists`)
      runs.set(run.id, { ...run })
      points.set(run.id, [])
    },
    async updateRun(run) {
      if (!runs.has(run.id)) throw new Error(`Run ${run.id} not found`)
      // The name is changed only by renameRun, as in SQLite
      runs.set(run.id, { ...run, name: runs.get(run.id)!.name })
    },
    async addPoint(runId, segment, point) {
      const list = points.get(runId)
      if (!list) throw new Error(`Run ${runId} not found`)
      list.push({ ...point, segment })
    },
    async renameRun(id, name) {
      const run = runs.get(id)
      if (!run) throw new Error(`Run ${id} not found`)
      run.name = name
    },
    async deleteRun(id) {
      runs.delete(id)
      points.delete(id)
    },
    async findUnfinished() {
      return [...runs.values()]
        .filter((r) => r.status !== 'finished')
        .sort((a, b) => b.startedAt - a.startedAt)
        .map((r) => ({ ...r }))
    },
    async getRun(id) {
      const run = runs.get(id)
      return run ? { ...run } : null
    },
    async listFinished() {
      return [...runs.values()]
        .filter((r) => r.status === 'finished')
        .sort((a, b) => b.startedAt - a.startedAt)
        .map((r) => ({ ...r }))
    },
    async loadPoints(runId) {
      return (points.get(runId) ?? []).map((p) => ({ ...p }))
    },
  }
}
