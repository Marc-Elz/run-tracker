import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryRunRepository } from '@/lib/db/memoryRunRepository'
import type { RunRecord } from '@/lib/db/runRepository'
import { useRunStore } from '@/stores/run'
import RunSummaryView from '../RunSummaryView.vue'

const nav = vi.hoisted(() => ({
  params: { id: 'r1' },
  replace: vi.fn<(to: unknown) => Promise<void>>(async () => {}),
  back: vi.fn<() => void>(),
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: nav.params }),
  useRouter: () => nav,
}))

const share = vi.hoisted(() => ({
  shareGpx: vi.fn<(fileName: string, xml: string) => Promise<void>>(async () => {}),
}))
vi.mock('@/lib/shareRun', () => share)

// MapLibre needs WebGL, which jsdom does not have; the map has its own checks in the browser
const RouteMap = { props: ['route'], template: '<div class="map-stub">{{ route.lines.length }}</div>' }

const record: RunRecord = {
  id: 'r1',
  name: null,
  status: 'finished',
  startedAt: Date.UTC(2026, 9, 26, 7, 12),
  finishedAt: Date.UTC(2026, 9, 26, 7, 40),
  elapsedMs: 3000,
  segment: 0,
  segmentStartedAt: null,
  movingMs: 3000,
  distanceM: 33,
}

const button = (wrapper: ReturnType<typeof mount>, label: string) =>
  wrapper.findAll('button').find((b) => b.text() === label)
const dialogButton = (wrapper: ReturnType<typeof mount>, label: string) =>
  wrapper.find('.dialog').findAll('button').find((b) => b.text() === label)

async function open(seed = true) {
  const repo = createMemoryRunRepository()
  if (seed) {
    await repo.createRun(record)
    for (let i = 0; i < 4; i++) {
      await repo.addPoint('r1', 0, { lat: 52 + i * 0.0001, lon: 4, timestamp: i * 2000, accuracy: 5 })
    }
  }
  useRunStore().useRepository(repo)
  const wrapper = mount(RunSummaryView, { global: { stubs: { RouteMap } } })
  await flushPromises()
  return { wrapper, repo }
}

describe('RunSummaryView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows distance, time, moving time and average pace with the route', async () => {
    const { wrapper } = await open()
    const text = wrapper.text()
    expect(text).toContain('0.03') // km from the raw points
    expect(text).toContain('00:03') // elapsed
    expect(text).toContain('00:06') // moving
    expect(text).toMatch(/\d+:\d{2}/) // pace
    expect(wrapper.find('.map-stub').text()).toBe('1')
  })

  it('lists the splits, ending with the partial km', async () => {
    const { wrapper } = await open()
    const rows = wrapper.findAll('.split')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.text()).toContain('0.03 km')
  })

  it('titles an unnamed run by its date and renames it from the editor', async () => {
    const { wrapper, repo } = await open()
    expect(wrapper.find('.title__name').text()).toContain('·')
    expect(wrapper.find('.title__when').exists()).toBe(false)

    await button(wrapper, 'Rename')!.trigger('click')
    expect(button(wrapper, 'Rename')).toBeUndefined()
    await wrapper.find('.rename__input').setValue('  Morning loop ')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('.rename').exists()).toBe(false)
    expect(wrapper.find('.title__name').text()).toBe('Morning loop')
    expect(wrapper.find('.title__when').text()).toContain('·')
    expect((await repo.getRun('r1'))?.name).toBe('Morning loop')
  })

  it('starts the editor on the current name and clears it when saved empty', async () => {
    const { wrapper, repo } = await open()
    await repo.renameRun('r1', 'Morning loop')
    await wrapper.unmount()
    const again = mount(RunSummaryView, { global: { stubs: { RouteMap } } })
    await flushPromises()
    expect(again.find('.title__name').text()).toBe('Morning loop')

    await button(again, 'Rename')!.trigger('click')
    expect((again.find('.rename__input').element as HTMLInputElement).value).toBe('Morning loop')
    await again.find('.rename__input').setValue('   ')
    await again.find('form').trigger('submit')
    await flushPromises()

    expect(again.find('.title__name').text()).toContain('·')
    expect((await repo.getRun('r1'))?.name).toBeNull()
  })

  it('cancels without saving', async () => {
    const { wrapper, repo } = await open()
    await button(wrapper, 'Rename')!.trigger('click')
    await wrapper.find('.rename__input').setValue('Nope')
    await button(wrapper, 'Cancel')!.trigger('click')
    expect(wrapper.find('.rename').exists()).toBe(false)
    expect((await repo.getRun('r1'))?.name).toBeNull()
  })

  it('keeps the editor open and the old name when saving fails', async () => {
    const { wrapper, repo } = await open()
    useRunStore().useRepository({
      ...repo,
      renameRun: vi.fn<() => Promise<never>>().mockRejectedValue(new Error('x')),
    })
    await button(wrapper, 'Rename')!.trigger('click')
    await wrapper.find('.rename__input').setValue('Morning loop')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Could not save the name')
    expect(wrapper.find('.rename').exists()).toBe(true)
    expect((await repo.getRun('r1'))?.name).toBeNull()
  })

  it('says so when the run does not exist', async () => {
    const { wrapper } = await open(false)
    expect(wrapper.text()).toContain('Run not found')
    await button(wrapper, 'Back to History')!.trigger('click')
    expect(nav.replace).toHaveBeenCalledWith({ name: 'history' })
  })

  it('offers a retry when the run cannot be loaded', async () => {
    const repo = createMemoryRunRepository()
    useRunStore().useRepository({ ...repo, getRun: vi.fn<() => Promise<never>>().mockRejectedValue(new Error('x')) })
    const wrapper = mount(RunSummaryView, { global: { stubs: { RouteMap } } })
    await flushPromises()
    expect(wrapper.text()).toContain('Could not load the run')
    expect(button(wrapper, 'Retry')).toBeDefined()
  })

  it('exports the run as GPX, and says so when that fails', async () => {
    const { wrapper } = await open()
    await button(wrapper, 'Export GPX')!.trigger('click')
    await flushPromises()
    expect(share.shareGpx).toHaveBeenCalledOnce()
    const [fileName, xml] = share.shareGpx.mock.calls[0]!
    expect(fileName).toMatch(/^run-\d{4}-\d{2}-\d{2}-\d{4}\.gpx$/)
    expect(xml).toContain('<trkpt lat="52.0000000" lon="4.0000000">')
    expect(wrapper.text()).not.toContain('Could not export')

    share.shareGpx.mockRejectedValueOnce(new Error('disk full'))
    await button(wrapper, 'Export GPX')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Could not export the run')
  })

  it('asks before deleting, then deletes the run and goes to History', async () => {
    const { wrapper, repo } = await open()
    await button(wrapper, 'Delete')!.trigger('click')
    expect(wrapper.text()).toContain('Delete this run?')

    await dialogButton(wrapper, 'Keep')!.trigger('click')
    expect(wrapper.text()).not.toContain('Delete this run?')
    expect(await repo.getRun('r1')).not.toBeNull()

    await button(wrapper, 'Delete')!.trigger('click')
    await dialogButton(wrapper, 'Delete')!.trigger('click')
    await flushPromises()
    expect(await repo.getRun('r1')).toBeNull()
    expect(await repo.loadPoints('r1')).toEqual([])
    expect(nav.replace).toHaveBeenCalledWith({ name: 'history' })
  })

  it('keeps the dialog open and says so when deleting fails', async () => {
    const { wrapper, repo } = await open()
    useRunStore().useRepository({ ...repo, deleteRun: vi.fn<() => Promise<never>>().mockRejectedValue(new Error('x')) })
    await button(wrapper, 'Delete')!.trigger('click')
    await dialogButton(wrapper, 'Delete')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Could not delete the run')
    expect(nav.replace).not.toHaveBeenCalled()
  })
})
