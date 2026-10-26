import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { TrackPoint } from '@/lib/geo'
import { GpsError, startGps } from '@/lib/gps'
import { createMemoryRunRepository } from '@/lib/db/memoryRunRepository'
import { useRunStore } from '@/stores/run'
import RunView from '../RunView.vue'

vi.mock('@capacitor-community/keep-awake', () => ({
  KeepAwake: {
    isSupported: async () => ({ isSupported: false }),
    keepAwake: async () => {},
    allowSleep: async () => {},
  },
}))

// Capture the callbacks the view hands to GPS, so the test plays the GPS
const gps = vi.hoisted(() => ({
  onPoint: null as ((p: TrackPoint) => void) | null,
  onError: null as ((e: Error) => void) | null,
  stop: vi.fn<() => void>(),
}))
vi.mock('@/lib/gps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/gps')>()),
  startGps: vi.fn<
    (onPoint: (p: TrackPoint) => void, onError: (e: Error) => void) => Promise<() => void>
  >(async (onPoint: (p: TrackPoint) => void, onError: (e: Error) => void) => {
    gps.onPoint = onPoint
    gps.onError = onError
    return gps.stop
  }),
  openAppSettings: vi.fn<() => Promise<void>>(async () => {}),
}))

const share = vi.hoisted(() => ({
  shareGpx: vi.fn<(fileName: string, xml: string) => Promise<void>>(async () => {}),
}))
vi.mock('@/lib/shareRun', () => share)

const button = (wrapper: ReturnType<typeof mount>, label: string) =>
  wrapper.findAll('button').find((b) => b.text() === label)

async function start(wrapper: ReturnType<typeof mount>) {
  await button(wrapper, 'Start')!.trigger('click')
  await flushPromises()
}

describe('RunView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('walks through start, pause, resume and stop', async () => {
    const wrapper = mount(RunView)
    expect(wrapper.text()).toContain('00:00')

    await start(wrapper)
    expect(wrapper.attributes('data-status')).toBe('running')
    expect(button(wrapper, 'Stop')).toBeUndefined() // can't stop by accident mid-run

    await button(wrapper, 'Pause')!.trigger('click')
    expect(wrapper.attributes('data-status')).toBe('paused')
    expect(gps.stop).not.toHaveBeenCalled() // GPS stays on while paused

    await button(wrapper, 'Resume')!.trigger('click')
    expect(wrapper.attributes('data-status')).toBe('running')

    await button(wrapper, 'Pause')!.trigger('click')
    await button(wrapper, 'Stop')!.trigger('click')
    expect(wrapper.attributes('data-status')).toBe('finished')
    expect(gps.stop).toHaveBeenCalledOnce()

    await button(wrapper, 'Done')!.trigger('click')
    expect(wrapper.attributes('data-status')).toBe('idle')
  })

  it('shows "Acquiring GPS" until the first usable fix', async () => {
    const wrapper = mount(RunView)
    await start(wrapper)
    expect(wrapper.text()).toContain('Acquiring GPS')

    gps.onPoint!({ lat: 52, lon: 4, timestamp: Date.now(), accuracy: 80 }) // too inaccurate
    await flushPromises()
    expect(wrapper.text()).toContain('Acquiring GPS')

    gps.onPoint!({ lat: 52, lon: 4, timestamp: Date.now(), accuracy: 5 })
    await flushPromises()
    expect(wrapper.text()).not.toContain('Acquiring GPS')
  })

  it('goes back to idle with a settings button when location is refused', async () => {
    const wrapper = mount(RunView)
    await start(wrapper)
    gps.onError!(new GpsError('denied', 'User denied location permission'))
    await flushPromises()

    expect(wrapper.attributes('data-status')).toBe('idle')
    expect(wrapper.text()).toContain('Location permission is needed')
    expect(button(wrapper, 'Open settings')).toBeDefined()
  })

  it('keeps a run in progress when location goes off mid-run', async () => {
    const wrapper = mount(RunView)
    await start(wrapper)
    gps.onPoint!({ lat: 52, lon: 4, timestamp: Date.now(), accuracy: 5 })
    gps.onError!(new GpsError('disabled', 'Location services disabled.'))
    await flushPromises()

    expect(wrapper.attributes('data-status')).toBe('running')
    expect(wrapper.text()).toContain('Location is off')
  })

  it('deletes the run when location is refused before the first fix', async () => {
    const repo = createMemoryRunRepository()
    useRunStore().useRepository(repo)
    const wrapper = mount(RunView)
    await start(wrapper)
    gps.onError!(new GpsError('denied', 'User denied location permission'))
    await flushPromises()
    expect(await repo.findUnfinished()).toEqual([])
  })

  it('exports the finished run as GPX, and says so when that fails', async () => {
    const wrapper = mount(RunView)
    await start(wrapper)
    expect(button(wrapper, 'Export GPX')).toBeUndefined() // only once the run is finished
    gps.onPoint!({ lat: 52, lon: 4, timestamp: Date.now(), accuracy: 5 })
    await button(wrapper, 'Pause')!.trigger('click')
    expect(button(wrapper, 'Export GPX')).toBeUndefined()
    await button(wrapper, 'Stop')!.trigger('click')

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

  it('asks before discarding a finished run', async () => {
    const repo = createMemoryRunRepository()
    const run = useRunStore()
    run.useRepository(repo)
    const wrapper = mount(RunView)
    await start(wrapper)
    gps.onPoint!({ lat: 52, lon: 4, timestamp: Date.now(), accuracy: 5 })
    const id = run.runId!
    await button(wrapper, 'Pause')!.trigger('click')
    await button(wrapper, 'Stop')!.trigger('click')

    await button(wrapper, 'Discard')!.trigger('click')
    expect(wrapper.text()).toContain('Delete this run')
    await button(wrapper, 'Keep')!.trigger('click')
    expect(wrapper.attributes('data-status')).toBe('finished')

    await button(wrapper, 'Discard')!.trigger('click')
    await button(wrapper, 'Delete')!.trigger('click')
    expect(wrapper.attributes('data-status')).toBe('idle')
    expect(await repo.loadPoints(id)).toEqual([])
  })

  it('shows a recovered run and starts GPS on Resume', async () => {
    const repo = createMemoryRunRepository()
    await repo.createRun({
      id: 'r1',
      status: 'running',
      startedAt: 0,
      finishedAt: null,
      elapsedMs: 0,
      segment: 0,
      segmentStartedAt: 0,
      movingMs: 0,
      distanceM: 0,
    })
    await repo.addPoint('r1', 0, { lat: 52, lon: 4, timestamp: 1000, accuracy: 5 })
    const run = useRunStore()
    run.useRepository(repo)
    await run.recover()

    const wrapper = mount(RunView)
    expect(wrapper.attributes('data-status')).toBe('paused')
    expect(wrapper.text()).toContain('Run recovered')
    expect(startGps).not.toHaveBeenCalled()

    await button(wrapper, 'Resume')!.trigger('click')
    await flushPromises()
    expect(wrapper.attributes('data-status')).toBe('running')
    expect(startGps).toHaveBeenCalledOnce()
    expect(wrapper.text()).not.toContain('Run recovered')
  })

  it('warns when the run is not being saved', async () => {
    const run = useRunStore()
    const wrapper = mount(RunView)
    run.saveError = true
    await flushPromises()
    expect(wrapper.text()).toContain('Not saving')
  })
})
