import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryRunRepository } from '@/lib/db/memoryRunRepository'
import type { RunRecord } from '@/lib/db/runRepository'
import { useRunStore } from '@/stores/run'
import HeatmapView from '../HeatmapView.vue'

const nav = vi.hoisted(() => ({
  push: vi.fn<(to: unknown) => Promise<void>>(async () => {}),
  replace: vi.fn<(to: unknown) => Promise<void>>(async () => {}),
  back: vi.fn<() => void>(),
}))
vi.mock('vue-router', () => ({ useRouter: () => nav }))

// MapLibre needs WebGL, which jsdom does not have; the map is checked in the browser and on the phone
const RoutesMap = {
  props: ['overviews', 'selectedId'],
  emits: ['tap'],
  template: '<div class="map-stub" :data-selected="selectedId">{{ overviews.length }}</div>',
}

const finished = (id: string, startedAt: number, name: string | null = null): RunRecord => ({
  id,
  name,
  status: 'finished',
  startedAt,
  finishedAt: startedAt + 60_000,
  elapsedMs: 600_000,
  segment: 0,
  segmentStartedAt: null,
  movingMs: 600_000,
  distanceM: 2000,
  sessionId: null,
})

async function addRun(repo: ReturnType<typeof createMemoryRunRepository>, run: RunRecord) {
  await repo.createRun(run)
  for (let i = 0; i < 5; i++) {
    await repo.addPoint(run.id, 0, { lat: 52 + i * 0.0003, lon: 4, timestamp: i * 10_000 })
  }
}

const mountView = async () => {
  const wrapper = mount(HeatmapView, { global: { stubs: { RoutesMap } } })
  await flushPromises()
  // Building yields to the event loop between batches; wait for the loading text to go
  await vi.waitFor(() => expect(wrapper.find('[role="status"].message').exists()).toBe(false))
  return wrapper
}

const tap = async (wrapper: Awaited<ReturnType<typeof mountView>>, ids: string[]) => {
  wrapper.findComponent(RoutesMap).vm.$emit('tap', ids)
  await flushPromises()
}

describe('HeatmapView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('draws every run that has a route and shows how many', async () => {
    const repo = createMemoryRunRepository()
    await addRun(repo, finished('a', 1000))
    await addRun(repo, finished('b', 2000))
    await repo.createRun(finished('empty', 3000)) // no GPS points: nothing to draw
    useRunStore().useRepository(repo)

    const wrapper = await mountView()
    expect(wrapper.find('.map-stub').text()).toBe('2')
    expect(wrapper.find('.count').text()).toBe('2 runs')
  })

  it('shows an empty state when there is nothing to draw', async () => {
    useRunStore().useRepository(createMemoryRunRepository())
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('No routes to show yet')
    expect(wrapper.find('.map-stub').exists()).toBe(false)
    expect(wrapper.find('.count').exists()).toBe(false)
  })

  it('shows an error with a retry when the routes cannot be loaded', async () => {
    const repo = createMemoryRunRepository()
    await addRun(repo, finished('a', 1000))
    vi.spyOn(repo, 'readOverviews').mockRejectedValueOnce(new Error('disk'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    useRunStore().useRepository(repo)

    const wrapper = await mountView()
    expect(wrapper.text()).toContain('Could not load routes')
    await wrapper.find('.btn').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('.map-stub').exists()).toBe(true))
  })

  it('mentions runs that could not be drawn without blocking the map', async () => {
    const repo = createMemoryRunRepository()
    await addRun(repo, finished('a', 1000))
    await addRun(repo, finished('b', 2000))
    vi.spyOn(repo, 'loadPoints').mockRejectedValueOnce(new Error('disk'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    useRunStore().useRepository(repo)

    const wrapper = await mountView()
    expect(wrapper.find('.skipped').text()).toBe('1 run could not be drawn')
    expect(wrapper.find('.map-stub').text()).toBe('1')
  })

  it('shows a card for the tapped run and opens it', async () => {
    const repo = createMemoryRunRepository()
    await addRun(repo, finished('a', Date.UTC(2026, 9, 26, 7, 12), 'Evening loop'))
    useRunStore().useRepository(repo)

    const wrapper = await mountView()
    expect(wrapper.find('.card').exists()).toBe(false)
    await tap(wrapper, ['a'])
    expect(wrapper.find('.card').text()).toContain('Evening loop')
    expect(wrapper.find('.card').text()).toContain('2.00 km')
    expect(wrapper.find('.card').text()).toContain('5:00 /km')
    expect(wrapper.find('.pager').exists()).toBe(false)
    expect(wrapper.find('.map-stub').attributes('data-selected')).toBe('a')

    await wrapper.find('.btn--primary').trigger('click')
    expect(nav.push).toHaveBeenCalledWith({ name: 'run-summary', params: { id: 'a' } })
  })

  it('lists overlapping runs newest first and steps through them', async () => {
    const repo = createMemoryRunRepository()
    await addRun(repo, finished('old', 1000, 'Old'))
    await addRun(repo, finished('new', 3000, 'New'))
    await addRun(repo, finished('mid', 2000, 'Mid'))
    useRunStore().useRepository(repo)

    const wrapper = await mountView()
    await tap(wrapper, ['old', 'new', 'mid'])
    expect(wrapper.find('.card__name').text()).toBe('New')
    expect(wrapper.find('.pager__count').text()).toBe('1/3')

    await wrapper.find('[aria-label="Next run"]').trigger('click')
    expect(wrapper.find('.card__name').text()).toBe('Mid')
    await wrapper.find('[aria-label="Next run"]').trigger('click')
    await wrapper.find('[aria-label="Next run"]').trigger('click')
    expect(wrapper.find('.card__name').text()).toBe('New') // wraps around
    await wrapper.find('[aria-label="Previous run"]').trigger('click')
    expect(wrapper.find('.card__name').text()).toBe('Old')
    expect(wrapper.find('.map-stub').attributes('data-selected')).toBe('old')
  })

  it('clears the selection when the tap hits nothing', async () => {
    const repo = createMemoryRunRepository()
    await addRun(repo, finished('a', 1000))
    useRunStore().useRepository(repo)

    const wrapper = await mountView()
    await tap(wrapper, ['a'])
    await tap(wrapper, [])
    expect(wrapper.find('.card').exists()).toBe(false)
  })

  it('goes back in history, or to History when there is nothing behind', async () => {
    useRunStore().useRepository(createMemoryRunRepository())
    const wrapper = await mountView()

    window.history.replaceState({ back: '/history' }, '')
    await wrapper.find('.back').trigger('click')
    expect(nav.back).toHaveBeenCalled()

    window.history.replaceState({}, '')
    await wrapper.find('.back').trigger('click')
    expect(nav.replace).toHaveBeenCalledWith({ name: 'history' })
  })
})
