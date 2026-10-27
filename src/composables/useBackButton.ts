import { onBeforeUnmount, type Ref } from 'vue'
import type { Router } from 'vue-router'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'

interface Interceptor {
  active: Ref<boolean>
  onBack: () => void
}

/** Screens with something open (an editor, a dialog) that back should close first; newest wins */
const interceptors: Interceptor[] = []

/**
 * While `active` is true, the Android back button calls `onBack` instead of leaving the screen.
 * Call from a component's setup; it stops intercepting when that component unmounts.
 */
export function useBackInterceptor(active: Ref<boolean>, onBack: () => void) {
  const interceptor: Interceptor = { active, onBack }
  interceptors.push(interceptor)
  onBeforeUnmount(() => {
    const index = interceptors.indexOf(interceptor)
    if (index !== -1) interceptors.splice(index, 1)
  })
}

/**
 * Android back button. First closes whatever a screen has open (see `useBackInterceptor`). Then on
 * another tab it goes back to the Run tab. On the Run tab it sends the app to the background while
 * a run is on (leaving would stop the GPS service) and closes it otherwise.
 */
export function useBackButton(router: Router, runActive: Ref<boolean>) {
  if (!Capacitor.isNativePlatform()) return

  const handle = App.addListener('backButton', () => {
    const open = [...interceptors].reverse().find((i) => i.active.value)
    if (open) open.onBack()
    else if (router.currentRoute.value.name !== 'run') void router.replace({ name: 'run' })
    else if (runActive.value) void App.minimizeApp()
    else void App.exitApp()
  })
  onBeforeUnmount(() => void handle.then((h) => h.remove()))
}
