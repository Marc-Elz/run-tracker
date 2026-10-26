import { onBeforeUnmount, type Ref } from 'vue'
import type { Router } from 'vue-router'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'

/**
 * Android back button. On another tab it goes back to the Run tab. On the Run tab it sends the app
 * to the background while a run is on (leaving would stop the GPS service) and closes it otherwise.
 */
export function useBackButton(router: Router, runActive: Ref<boolean>) {
  if (!Capacitor.isNativePlatform()) return

  const handle = App.addListener('backButton', () => {
    if (router.currentRoute.value.name !== 'run') void router.replace({ name: 'run' })
    else if (runActive.value) void App.minimizeApp()
    else void App.exitApp()
  })
  onBeforeUnmount(() => void handle.then((h) => h.remove()))
}
