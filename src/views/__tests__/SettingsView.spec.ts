import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { TrackingStatus } from '@/lib/trackingStatus'
import SettingsView from '../SettingsView.vue'

const mocks = vi.hoisted(() => ({
  status: null as TrackingStatus | null,
  resume: null as (() => void) | null,
  getTrackingStatus: vi.fn<() => Promise<TrackingStatus | null>>(),
  openAppSettings: vi.fn<() => Promise<void>>(async () => {}),
  requestLocationPermission: vi.fn<() => Promise<string>>(async () => 'granted'),
  ensureNotifications: vi.fn<() => Promise<boolean>>(async () => true),
  askBatteryExemption: vi.fn<() => Promise<boolean>>(async () => true),
  openBatterySettings: vi.fn<() => Promise<void>>(async () => {}),
}))

vi.mock('@/lib/trackingStatus', () => ({ getTrackingStatus: mocks.getTrackingStatus }))
vi.mock('@/lib/gps', () => ({
  openAppSettings: mocks.openAppSettings,
  requestLocationPermission: mocks.requestLocationPermission,
}))
vi.mock('@/lib/runPower', () => ({
  ensureNotifications: mocks.ensureNotifications,
  askBatteryExemption: mocks.askBatteryExemption,
  openBatterySettings: mocks.openBatterySettings,
}))
vi.mock('@/composables/useAppResume', () => ({
  useAppResume: (cb: () => void) => {
    mocks.resume = cb
  },
}))

const allGood: TrackingStatus = { location: 'granted', notifications: 'granted', battery: 'exempt' }

const button = (wrapper: ReturnType<typeof mount>, label: string) =>
  wrapper.findAll('button').find((b) => b.text() === label)

async function open(status: TrackingStatus | null) {
  mocks.getTrackingStatus.mockResolvedValue(status)
  const wrapper = mount(SettingsView)
  await flushPromises()
  return wrapper
}

describe('SettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('says ready when everything is allowed, and still shows the Samsung hint and units', async () => {
    const wrapper = await open(allGood)
    expect(wrapper.text()).toContain('Ready to track')
    expect(wrapper.text()).toContain('Allowed')
    expect(wrapper.text()).toContain('Only this time') // the tip: the state itself can't tell
    expect(wrapper.text()).not.toContain('all the time')
    expect(button(wrapper, 'Allow')).toBeUndefined() // nothing to fix, only the revoke links
    expect(wrapper.text()).toContain('Never sleeping apps')
    expect(wrapper.text()).toContain('Metric (km, min/km)')
  })

  it('offers Allow for a permission that can still be asked, and Open settings once refused', async () => {
    const wrapper = await open({ ...allGood, location: 'prompt', notifications: 'denied' })
    expect(wrapper.text()).toContain('2 things need attention')

    await button(wrapper, 'Allow')!.trigger('click')
    expect(mocks.requestLocationPermission).toHaveBeenCalledOnce()

    await button(wrapper, 'Open settings')!.trigger('click')
    expect(mocks.openAppSettings).toHaveBeenCalledOnce()
    expect(mocks.ensureNotifications).not.toHaveBeenCalled()
  })

  it('asks for the notification permission from the Notifications row', async () => {
    const wrapper = await open({ ...allGood, notifications: 'prompt' })
    await button(wrapper, 'Allow')!.trigger('click')
    expect(mocks.ensureNotifications).toHaveBeenCalledOnce()
  })

  it('opens the battery dialog and refreshes the rows afterwards', async () => {
    const wrapper = await open({ ...allGood, battery: 'not-exempt' })
    expect(wrapper.text()).toContain('1 thing needs attention')
    expect(wrapper.text()).toContain('Never sleeping apps')

    mocks.getTrackingStatus.mockResolvedValue(allGood)
    await button(wrapper, 'Allow')!.trigger('click')
    await flushPromises()
    expect(mocks.askBatteryExemption).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Ready to track')
  })

  it('refreshes when the app comes back from Android settings', async () => {
    const wrapper = await open({ ...allGood, location: 'denied' })
    expect(button(wrapper, 'Open settings')).toBeDefined()

    mocks.getTrackingStatus.mockResolvedValue(allGood)
    mocks.resume!()
    await flushPromises()
    expect(button(wrapper, 'Open settings')).toBeUndefined()
    expect(wrapper.text()).toContain('Ready to track')
  })

  it('shows Could not check on the row that failed, without a button', async () => {
    const wrapper = await open({ ...allGood, notifications: 'unknown' })
    expect(wrapper.text()).toContain('Could not check')
    expect(wrapper.text()).toContain('Some settings could not be checked')
    // only the other rows (location, battery) have their settings link
    expect(wrapper.findAll('button').map((b) => b.text())).toEqual([
      'Revoke in settings',
      'Change in settings',
    ])
  })

  it('lets you open the system pages to revoke or change what is granted', async () => {
    const wrapper = await open(allGood)
    expect(wrapper.findAll('button').map((b) => b.text())).toEqual([
      'Revoke in settings',
      'Revoke in settings',
      'Change in settings',
    ])

    await wrapper.findAll('button')[0]!.trigger('click')
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(mocks.openAppSettings).toHaveBeenCalledTimes(2)

    await button(wrapper, 'Change in settings')!.trigger('click')
    expect(mocks.openBatterySettings).toHaveBeenCalledOnce()
  })

  it('has no buttons in the browser', async () => {
    const wrapper = await open(null)
    expect(wrapper.text()).toContain('Only available on the phone')
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.text()).toContain('Metric (km, min/km)')
  })
})
