import { Capacitor, registerPlugin } from '@capacitor/core'

/** Local native plugin: android/app/src/main/java/com/runtracker/app/RunPowerPlugin.java */
interface RunPowerPlugin {
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>
  requestIgnoreBatteryOptimizations(): Promise<{ ignoring: boolean }>
  requestNotifications(): Promise<{ granted: boolean }>
  openBatterySettings(): Promise<void>
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
