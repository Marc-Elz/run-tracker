import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallbackError, Location } from '@capacitor-community/background-geolocation'
import type { TrackPoint } from '@/lib/geo'

type Callback = (location?: Location, error?: CallbackError) => void

const plugin = vi.hoisted(() => ({
  callback: null as Callback | null,
  addWatcher: vi.fn<(options: unknown, cb: Callback) => Promise<string>>(),
  removeWatcher: vi.fn<(options: { id: string }) => Promise<void>>(async () => {}),
  openSettings: vi.fn<() => Promise<void>>(async () => {}),
}))
const native = vi.hoisted(() => ({ value: true }))
const simulation = vi.hoisted(() => ({ stop: vi.fn<() => void>() }))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.value },
  registerPlugin: () => plugin,
}))
vi.mock('@/lib/simulateGps', () => ({
  startGpsSimulation: vi.fn<() => () => void>(() => simulation.stop),
}))

import { GpsError, startGps, toTrackPoint } from '../gps'
import { startGpsSimulation } from '@/lib/simulateGps'

const location = (over: Partial<Location> = {}): Location => ({
  latitude: 52,
  longitude: 4,
  accuracy: 6,
  altitude: 3,
  altitudeAccuracy: null,
  simulated: false,
  bearing: null,
  speed: 2.8,
  time: 1000,
  ...over,
})

const pointFn = () => vi.fn<(p: TrackPoint) => void>()
const errorFn = () => vi.fn<(e: Error) => void>()

const notAuthorized = (message: string): CallbackError =>
  Object.assign(new Error(message), { code: 'NOT_AUTHORIZED' })

describe('toTrackPoint', () => {
  it('keeps accuracy, altitude and speed', () => {
    expect(toTrackPoint(location())).toEqual({
      lat: 52,
      lon: 4,
      timestamp: 1000,
      accuracy: 6,
      altitude: 3,
      speed: 2.8,
    })
  })

  it('drops missing values and falls back to now for a missing time', () => {
    const point = toTrackPoint(location({ time: null, altitude: null, speed: null }), 5000)
    expect(point).toEqual({ lat: 52, lon: 4, timestamp: 5000, accuracy: 6 })
  })
})

describe('startGps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    native.value = true
    plugin.addWatcher.mockImplementation(async (_options: unknown, cb: Callback) => {
      plugin.callback = cb
      return 'w1'
    })
  })

  it('uses the simulator outside the native app or when asked', async () => {
    native.value = false
    expect(await startGps(pointFn(), errorFn())).toBe(simulation.stop)
    native.value = true
    expect(await startGps(pointFn(), errorFn(), { simulate: true })).toBe(simulation.stop)
    expect(startGpsSimulation).toHaveBeenCalledTimes(2)
    expect(plugin.addWatcher).not.toHaveBeenCalled()
  })

  it('runs a background watcher and delivers every fix', async () => {
    const onPoint = pointFn()
    const stop = await startGps(onPoint, errorFn())
    expect(plugin.addWatcher.mock.calls[0]![0]).toMatchObject({
      backgroundMessage: expect.any(String),
      requestPermissions: true,
      distanceFilter: 0,
    })
    plugin.callback!(location())
    plugin.callback!(location({ time: 2000, accuracy: 80 })) // poor fix is still delivered
    expect(onPoint).toHaveBeenCalledTimes(2)

    stop()
    expect(plugin.removeWatcher).toHaveBeenCalledWith({ id: 'w1' })
  })

  it('reports a refused permission and removes the watcher', async () => {
    const onError = errorFn()
    await startGps(pointFn(), onError)
    plugin.callback!(undefined, notAuthorized('User denied location permission'))

    const err = onError.mock.calls[0]![0]
    expect(err).toBeInstanceOf(GpsError)
    expect((err as GpsError).failure).toBe('denied')
    expect(plugin.removeWatcher).toHaveBeenCalledWith({ id: 'w1' })
  })

  it('tells location switched off apart from a refused permission', async () => {
    const onError = errorFn()
    await startGps(pointFn(), onError)
    plugin.callback!(undefined, notAuthorized('Location services disabled.'))
    expect((onError.mock.calls[0]![0] as GpsError).failure).toBe('disabled')
  })

  it('removes the watcher when the refusal arrives before addWatcher resolves', async () => {
    const onError = errorFn()
    plugin.addWatcher.mockImplementation(async (_options: unknown, cb: Callback) => {
      cb(undefined, notAuthorized('Permission denied.'))
      return 'w2'
    })
    await startGps(pointFn(), onError)
    expect(onError).toHaveBeenCalledOnce()
    expect(plugin.removeWatcher).toHaveBeenCalledWith({ id: 'w2' })
  })

  it('passes other errors on without stopping', async () => {
    const onPoint = pointFn()
    const onError = errorFn()
    await startGps(onPoint, onError)
    plugin.callback!(undefined, Object.assign(new Error('glitch'), { code: 'OTHER' }))
    plugin.callback!(location())
    expect(onError.mock.calls[0]![0]).not.toBeInstanceOf(GpsError)
    expect(onPoint).toHaveBeenCalledOnce()
    expect(plugin.removeWatcher).not.toHaveBeenCalled()
  })

  it('ignores fixes after stop', async () => {
    const onPoint = pointFn()
    const stop = await startGps(onPoint, errorFn())
    stop()
    stop()
    plugin.callback!(location())
    expect(onPoint).not.toHaveBeenCalled()
    expect(plugin.removeWatcher).toHaveBeenCalledOnce()
  })
})
