import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ value: true }))
const checks = vi.hoisted(() => ({
  location: vi.fn<() => Promise<string | undefined>>(),
  notifications: vi.fn<() => Promise<string | undefined>>(),
  battery: vi.fn<() => Promise<boolean>>(),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.value } }))
vi.mock('@/lib/gps', () => ({ checkLocationPermission: checks.location }))
vi.mock('@/lib/runPower', () => ({
  checkNotificationPermission: checks.notifications,
  isBatteryExempt: checks.battery,
}))

import { getTrackingStatus } from '../trackingStatus'

describe('getTrackingStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    native.value = true
    checks.location.mockResolvedValue('granted')
    checks.notifications.mockResolvedValue('granted')
    checks.battery.mockResolvedValue(true)
  })

  it('is null in the browser', async () => {
    native.value = false
    expect(await getTrackingStatus()).toBeNull()
    expect(checks.location).not.toHaveBeenCalled()
  })

  it('reports the phone state', async () => {
    expect(await getTrackingStatus()).toEqual({
      location: 'granted',
      notifications: 'granted',
      battery: 'exempt',
    })

    checks.location.mockResolvedValue('denied')
    checks.notifications.mockResolvedValue('prompt')
    checks.battery.mockResolvedValue(false)
    expect(await getTrackingStatus()).toEqual({
      location: 'denied',
      notifications: 'prompt',
      battery: 'not-exempt',
    })
  })

  it('treats a refused-once permission as askable, and anything odd as unknown', async () => {
    checks.location.mockResolvedValue('prompt-with-rationale')
    checks.notifications.mockResolvedValue(undefined)
    expect(await getTrackingStatus()).toMatchObject({ location: 'prompt', notifications: 'unknown' })
  })

  it('gives unknown for the one check that fails', async () => {
    checks.notifications.mockRejectedValue(new Error('plugin missing'))
    expect(await getTrackingStatus()).toEqual({
      location: 'granted',
      notifications: 'unknown',
      battery: 'exempt',
    })
  })
})
