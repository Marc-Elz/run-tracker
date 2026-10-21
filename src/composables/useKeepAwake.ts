import { onBeforeUnmount, watch, type Ref } from 'vue'
import { KeepAwake } from '@capacitor-community/keep-awake'

/** Keeps the screen on while `active` is true (native plugin on Android, Wake Lock API in browsers). */
export function useKeepAwake(active: Ref<boolean>) {
  async function apply(on: boolean) {
    try {
      if (!(await KeepAwake.isSupported()).isSupported) return
      if (on) await KeepAwake.keepAwake()
      else await KeepAwake.allowSleep()
    } catch (err) {
      console.warn('Keep-awake unavailable', err)
    }
  }

  watch(active, (on) => void apply(on), { immediate: true })
  onBeforeUnmount(() => void apply(false))
}
