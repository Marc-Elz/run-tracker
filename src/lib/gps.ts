import { Capacitor, registerPlugin } from '@capacitor/core'
import type {
  BackgroundGeolocationPlugin,
  CallbackError,
  Location,
} from '@capacitor-community/background-geolocation'
import type { TrackPoint } from '@/lib/geo'
import { startGpsSimulation } from '@/lib/simulateGps'

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')

/** Why GPS stopped: permission refused, or location switched off on the phone */
export type GpsFailure = 'denied' | 'disabled'

export class GpsError extends Error {
  constructor(
    readonly failure: GpsFailure,
    message: string,
  ) {
    super(message)
  }
}

export interface GpsOptions {
  /** Use the fake GPS instead of the device (always the case outside the native app) */
  simulate?: boolean
}

export function toTrackPoint(location: Location, now: number = Date.now()): TrackPoint {
  const point: TrackPoint = {
    lat: location.latitude,
    lon: location.longitude,
    timestamp: location.time ?? now,
  }
  // The plugin sends null for values the fix doesn't have
  if (location.accuracy != null) point.accuracy = location.accuracy
  if (location.altitude != null) point.altitude = location.altitude
  if (location.speed != null) point.speed = location.speed
  return point
}

function toGpsError(error: CallbackError): GpsError {
  // The plugin reports both cases as NOT_AUTHORIZED; only the message tells them apart
  const failure = /disabled/i.test(error.message) ? 'disabled' : 'denied'
  return new GpsError(failure, error.message)
}

/** Largest time between consecutive fixes, logged on stop so `adb logcat` shows tracking gaps */
function gapLogger() {
  let last: number | null = null
  let maxGapMs = 0
  return {
    fix(point: TrackPoint) {
      if (last !== null) maxGapMs = Math.max(maxGapMs, point.timestamp - last)
      last = point.timestamp
      console.info('[gps] fix', point.timestamp, point.accuracy)
    },
    done() {
      console.info('[gps] stopped, largest gap between fixes (ms):', maxGapMs)
    },
  }
}

/**
 * Start delivering GPS fixes; resolves with a stop function. On the phone this runs a
 * foreground service, so fixes keep coming with the screen off or another app open.
 * Missing permission or location switched off arrive later through `onError` as a GpsError
 * (the plugin reports them via the callback, not the promise); GPS is stopped by then.
 */
export async function startGps(
  onPoint: (p: TrackPoint) => void,
  onError: (err: Error) => void,
  { simulate = false }: GpsOptions = {},
): Promise<() => void> {
  if (simulate || !Capacitor.isNativePlatform()) return startGpsSimulation(onPoint)

  const log = gapLogger()
  let id: string | null = null
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    log.done()
    if (id !== null) void BackgroundGeolocation.removeWatcher({ id })
  }

  id = await BackgroundGeolocation.addWatcher(
    {
      backgroundTitle: 'Run in progress',
      backgroundMessage: 'Recording your run',
      requestPermissions: true,
      stale: false,
      distanceFilter: 0,
    },
    (location, error) => {
      if (stopped) return
      if (error) {
        if (error.code === 'NOT_AUTHORIZED') {
          // A refused watcher stays registered in the service; remove it
          stop()
          onError(toGpsError(error))
        } else {
          console.warn('[gps] error', error)
          onError(error)
        }
      } else if (location) {
        const point = toTrackPoint(location)
        log.fix(point)
        onPoint(point)
      }
    },
  )
  // The error may have arrived before addWatcher resolved
  if (stopped) void BackgroundGeolocation.removeWatcher({ id })
  return stop
}

/** Open the app's settings page, where a refused location permission can be granted. */
export function openAppSettings(): Promise<void> {
  return BackgroundGeolocation.openSettings()
}
