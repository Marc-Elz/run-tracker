import type { RouteOverview } from '@/lib/routeOverview'
import type { RunStep } from '@/lib/stepProgress'
import type { RunRecord, RunRepository, StoredPoint } from './runRepository'

/**
 * Keeps runs in memory: used in the browser and in unit tests. It can't see the training
 * sessions (a separate repository), so a link to a deleted session stays.
 */
export function createMemoryRunRepository(): RunRepository {
  const runs = new Map<string, RunRecord>()
  const points = new Map<string, StoredPoint[]>()
  const overviews = new Map<string, RouteOverview>()
  const steps = new Map<string, RunStep[]>()

  return {
    async createRun(run) {
      if (runs.has(run.id)) throw new Error(`Run ${run.id} already exists`)
      runs.set(run.id, { ...run })
      points.set(run.id, [])
      return run.sessionId
    },
    async updateRun(run) {
      if (!runs.has(run.id)) throw new Error(`Run ${run.id} not found`)
      // The name is changed only by renameRun and the link only by createRun, as in SQLite
      const stored = runs.get(run.id)!
      runs.set(run.id, { ...run, name: stored.name, sessionId: stored.sessionId })
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
      steps.delete(id)
      overviews.delete(id)
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
    async importRun(run, imported, importedSteps = []) {
      if (runs.has(run.id)) return false
      runs.set(run.id, { ...run })
      points.set(
        run.id,
        imported.map((p) => ({ ...p })),
      )
      steps.set(
        run.id,
        importedSteps.map((s) => ({ ...s })),
      )
      return true
    },
    async saveStepChange(runId, ended, started) {
      if (!runs.has(runId)) throw new Error(`Run ${runId} not found`)
      const list = (steps.get(runId) ?? []).map((s) =>
        ended && s.position === ended.position ? { ...ended } : s,
      )
      for (const step of started) {
        if (list.some((s) => s.position === step.position)) {
          throw new Error(`Step ${step.position} of run ${runId} already exists`)
        }
        list.push({ ...step })
      }
      steps.set(runId, list)
    },
    async loadRunSteps(runId) {
      return (steps.get(runId) ?? []).map((s) => ({ ...s })).sort((a, b) => a.position - b.position)
    },
    async readOverviews() {
      return [...overviews.values()].filter((o) => runs.get(o.runId)?.status === 'finished')
    },
    async doneSessionIds() {
      const ids = [...runs.values()]
        .filter((r) => r.status === 'finished' && r.sessionId !== null)
        .map((r) => r.sessionId!)
      return [...new Set(ids)]
    },
    async setRunSession(runId, sessionId) {
      const run = runs.get(runId)
      if (!run) throw new Error(`Run ${runId} not found`)
      run.sessionId = sessionId
      return sessionId
    },
    async saveOverview(overview) {
      if (!runs.has(overview.runId)) throw new Error(`Run ${overview.runId} not found`)
      overviews.set(overview.runId, overview)
    },
  }
}
