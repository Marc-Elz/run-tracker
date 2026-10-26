import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { TrackPoint } from '@/lib/geo'
import { GpsError } from '@/lib/gps'
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
})
