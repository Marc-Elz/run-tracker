import { Capacitor, registerPlugin } from '@capacitor/core'

/** Local native plugin: android/app/src/main/java/com/runtracker/app/RunPowerPlugin.java */
interface RunPowerPlugin {
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>
  requestIgnoreBatteryOptimizations(): Promise<{ ignoring: boolean }>
  requestNotifications(): Promise<{ granted: boolean }>
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
