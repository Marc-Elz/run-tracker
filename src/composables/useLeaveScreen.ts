import { ref, type Ref } from 'vue'
import { useRouter, type RouteLocationRaw } from 'vue-router'
import { useBackInterceptor } from './useBackButton'

/**
 * For a screen one level down (a program, a form): leaving goes back to where you came from, or
 * to `parent` when the screen was opened directly. Android back does the same, instead of
 * jumping to the Run tab, but not while `busy` (a save in flight leaves by itself when it
 * succeeds). Leaving happens once, however often it is asked for. Call before any other
 * `useBackInterceptor` of the screen, so an open dialog still closes first.
 */
export function useLeaveScreen(parent: () => RouteLocationRaw, busy?: Ref<boolean>) {
  const router = useRouter()
  let left = false
  function leave() {
    if (left) return
    left = true
    if (window.history.state?.back) router.back()
    else void router.replace(parent())
  }
  useBackInterceptor(ref(true), () => {
    if (!busy?.value) leave()
  })
  return leave
}
