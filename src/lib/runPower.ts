import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

/** One motion reading from the phone (#154): `level` is missing when the sensor gave too few samples */
export interface MotionReading {
  /** Phone clock, ms */
  at: number
  /** Spread (standard deviation) of the acceleration over the last 2 s, m/s² */
  level?: number
  /** Readings the level is based on, for the log */
  samples: number
}

/** Local native plugin: android/app/src/main/java/com/runtracker/app/RunPowerPlugin.java */
interface RunPowerPlugin {
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>
  requestIgnoreBatteryOptimizations(): Promise<{ ignoring: boolean }>
  requestNotifications(): Promise<{ granted: boolean }>
  openBatterySettings(): Promise<void>
  requestAudioFocus(): Promise<void>
  abandonAudioFocus(): Promise<void>
  setKeepWebViewAlive(options: { keep: boolean }): Promise<void>
  setTimerService(options: { on: boolean }): Promise<void>
  startMotion(): Promise<{ available: boolean }>
  stopMotion(): Promise<void>
  addListener(
    event: 'motion',
    listener: (reading: MotionReading) => void,
  ): Promise<PluginListenerHandle>
  /** Added by Capacitor for the `notifications` alias */
  checkPermissions(): Promise<{ notifications?: string }>
}

const RunPower = registerPlugin<RunPowerPlugin>('RunPower')

let askedForBattery = false

/** Ask for the notification permission (Android 13+). Tracking works without it, only the notification is hidden. */
export async function ensureNotifications(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true
  try {
    return (await RunPower.requestNotifications()).granted
  } catch (err) {
    console.warn('Notification permission unavailable', err)
    return false
  }
}

/**
 * Whether the app is exempt from battery optimisation. Shows the system dialog the first
 * time per app session when it isn't; after that only reports.
 */
export async function ensureBatteryExemption(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true
  try {
    if (askedForBattery) return (await RunPower.isIgnoringBatteryOptimizations()).ignoring
    askedForBattery = true
    return (await RunPower.requestIgnoreBatteryOptimizations()).ignoring
  } catch (err) {
    console.warn('Battery optimisation check unavailable', err)
    return true
  }
}

/** Raw Capacitor state of the notification permission: granted, denied, prompt or prompt-with-rationale. */
export async function checkNotificationPermission(): Promise<string | undefined> {
  return (await RunPower.checkPermissions()).notifications
}

export async function isBatteryExempt(): Promise<boolean> {
  return (await RunPower.isIgnoringBatteryOptimizations()).ignoring
}

/** Open the system battery optimisation list, where the exemption can be taken away again. */
export function openBatterySettings(): Promise<void> {
  return RunPower.openBatterySettings()
}

/** Show the system exemption dialog (every call, unlike `ensureBatteryExemption`); resolves once it closes. */
export async function askBatteryExemption(): Promise<boolean> {
  return (await RunPower.requestIgnoreBatteryOptimizations()).ignoring
}

/** Ask other apps to lower their audio (not stop) while a cue is spoken. Never throws. */
export async function requestAudioFocus(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await RunPower.requestAudioFocus()
  } catch (err) {
    console.warn('Audio focus unavailable', err)
  }
}

/** Let other apps return to full volume. Never throws. */
export async function abandonAudioFocus(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await RunPower.abandonAudioFocus()
  } catch (err) {
    console.warn('Audio focus unavailable', err)
  }
}

/**
 * Start or stop the exercise timer's foreground service, which keeps Android from freezing the
 * app while the phone is locked (a run has the GPS service for that). Never throws.
 */
export async function timerService(on: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await RunPower.setTimerService({ on })
  } catch (err) {
    console.warn('Timer service unavailable; cues may stop with the screen locked', err)
  }
}

/** Keep the page's JavaScript running with the screen off while a run is on. Never throws. */
export async function keepWebViewAlive(keep: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await RunPower.setKeepWebViewAlive({ keep })
  } catch (err) {
    console.warn('Could not keep the page running in the background', err)
  }
}

/** Id of the newest `watchMotion` call */
let newestWatch = 0

/**
 * Auto-pause (#154): call `onReading` about once a second with the phone's motion level while
 * watching; returns the function that stops it. Does nothing off the phone, or on a phone without
 * an accelerometer, where auto-pause goes by GPS alone. Never throws.
 */
export function watchMotion(onReading: (reading: MotionReading) => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {}
  const id = ++newestWatch
  // The phone has one sensor switch: only the newest watcher may turn it off, so a stop that
  // lands late (an old watcher's) never switches off a newer watcher's sensor
  const stopSensor = () => {
    if (id !== newestWatch) return Promise.resolve()
    return RunPower.stopMotion()
  }
  let stopped = false
  let handle: PluginListenerHandle | null = null
  void (async () => {
    try {
      handle = await RunPower.addListener('motion', (reading) => {
        if (!stopped) onReading(reading)
      })
      if (stopped) return void handle.remove()
      const { available } = await RunPower.startMotion()
      // Stopped while starting: the stop's stopMotion may have run first, so stop again
      if (stopped) return void (await stopSensor())
      if (!available) console.info('[motion] no accelerometer: auto-pause goes by GPS alone')
    } catch (err) {
      console.warn('Motion sensor unavailable', err)
    }
  })()
  return () => {
    if (stopped) return
    stopped = true
    void handle?.remove()
    stopSensor().catch((err: unknown) => console.warn('Could not stop the motion sensor', err))
  }
}
