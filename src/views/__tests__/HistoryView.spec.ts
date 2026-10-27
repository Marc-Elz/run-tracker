import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryRunRepository } from '@/lib/db/memoryRunRepository'
import type { RunRecord } from '@/lib/db/runRepository'
import { useRunStore } from '@/stores/run'
import { buildRunSummary } from '@/lib/runSummary'
import { formatPace } from '@/lib/format'
import HistoryView from '../HistoryView.vue'

const link = { props: ['to'], template: '<a class="row" :data-id="to.params.id"><slot /></a>' }

const finished = (
  id: string,
  startedAt: number,
  distanceM: number,
  elapsedMs = 60_000,
): RunRecord => ({
  id,
  name: null,
  status: 'finished',
  startedAt,
  finishedAt: startedAt + 60_000,
  elapsedMs,
  segment: 0,
  segmentStartedAt: null,
  movingMs: 60_000,
  distanceM,
})

const mountView = async () => {
  const wrapper = mount(HistoryView, { global: { stubs: { RouterLink: link } } })
  await flushPromises()
  return wrapper
}

describe('HistoryView', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('lists finished runs, newest first, each linking to its summary', async () => {
    const repo = createMemoryRunRepository()
    await repo.createRun(finished('old', 1000, 5000))
    await repo.createRun(finished('new', 2000, 10_400))
    useRunStore().useRepository(repo)

    const rows = (await mountView()).findAll('.row')
    expect(rows.map((r) => r.attributes('data-id'))).toEqual(['new', 'old'])
    expect(rows[0]!.text()).toContain('10.40 km')
    expect(rows[0]!.text()).toContain('01:00')
    expect(rows[0]!.text()).toContain('0:06 /km')
  })

  it('shows a run by its name with the date below, else by its date', async () => {
    const repo = createMemoryRunRepository()
    await repo.createRun(finished('named', 2000, 5000))
    await repo.createRun(finished('plain', 1000, 5000))
    await repo.renameRun('named', 'Morning loop')
    useRunStore().useRepository(repo)

    const [named, plain] = (await mountView()).findAll('.row')
    expect(named!.find('.row__when').text()).toBe('Morning loop')
    expect(named!.find('.row__date').text()).toContain('·')
    expect(plain!.find('.row__when').text()).toContain('·')
    expect(plain!.find('.row__date').exists()).toBe(false)
  })

  it('shows a placeholder pace for a run too short to have one', async () => {
    const repo = createMemoryRunRepository()
    await repo.createRun(finished('short', 1000, 0))
    useRunStore().useRepository(repo)

    expect((await mountView()).find('.row').text()).toContain('--:-- /km')
  })

  it('shows the same pace as the run summary', async () => {
    const run = finished('a', 1000, 5000, 1_650_000)
    const repo = createMemoryRunRepository()
    await repo.createRun(run)
    useRunStore().useRepository(repo)

    const expected = formatPace(buildRunSummary(run, []).avgPaceSecPerKm)
    expect(expected).toBe('5:30')
    expect((await mountView()).find('.row').text()).toContain(`${expected} /km`)
  })

  it('shows an empty state', async () => {
    useRunStore().useRepository(createMemoryRunRepository())
    expect((await mountView()).text()).toContain('No runs yet')
  })

  it('shows an error with a retry when the list cannot be loaded', async () => {
    const repo = createMemoryRunRepository()
    const listFinished = vi
      .fn<() => Promise<RunRecord[]>>()
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue([])
    useRunStore().useRepository({ ...repo, listFinished })
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('Could not load runs')

    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('No runs yet')
  })
})
