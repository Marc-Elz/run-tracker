import { onBeforeUnmount } from 'vue'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'

/** Calls `onResume` whenever the app comes back to the foreground, e.g. from Android settings. */
export function useAppResume(onResume: () => void) {
  if (!Capacitor.isNativePlatform()) return

  const handle = App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) onResume()
  })
  onBeforeUnmount(() => void handle.then((h) => h.remove()))
}
