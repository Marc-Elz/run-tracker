import { Capacitor } from '@capacitor/core'
import { checkLocationPermission } from '@/lib/gps'
import { checkNotificationPermission, isBatteryExempt } from '@/lib/runPower'

export type PermissionStatus = 'granted' | 'prompt' | 'denied' | 'unknown'
export type BatteryStatus = 'exempt' | 'not-exempt' | 'unknown'

export interface TrackingStatus {
  location: PermissionStatus
  notifications: PermissionStatus
  battery: BatteryStatus
}

function toPermission(state: string | undefined): PermissionStatus {
  if (state === 'granted' || state === 'denied') return state
  // prompt-with-rationale: refused once, the system prompt can still be shown
  if (state === 'prompt' || state === 'prompt-with-rationale') return 'prompt'
  return 'unknown'
}

/** One failing check gives 'unknown' for that item only. */
async function attempt<T>(check: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await check()
  } catch (err) {
    console.warn('Status check failed', err)
    return fallback
  }
}

/** What the phone currently allows for tracking; null outside the native app. */
export async function getTrackingStatus(): Promise<TrackingStatus | null> {
  if (!Capacitor.isNativePlatform()) return null
  const [location, notifications, battery] = await Promise.all([
    attempt(async () => toPermission(await checkLocationPermission()), 'unknown' as const),
    attempt(async () => toPermission(await checkNotificationPermission()), 'unknown' as const),
    attempt(
      async () => ((await isBatteryExempt()) ? ('exempt' as const) : ('not-exempt' as const)),
      'unknown' as const,
    ),
  ])
  return { location, notifications, battery }
}
