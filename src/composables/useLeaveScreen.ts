import { ref } from 'vue'
import { useRouter, type RouteLocationRaw } from 'vue-router'
import { useBackInterceptor } from './useBackButton'

/**
 * For a screen one level down (a program, a form): leaving goes back to where you came from, or
 * to `parent` when the screen was opened directly. Android back does the same, instead of
 * jumping to the Run tab. Call before any other `useBackInterceptor` of the screen, so an open
 * dialog still closes first.
 */
export function useLeaveScreen(parent: () => RouteLocationRaw) {
  const router = useRouter()
  function leave() {
    if (window.history.state?.back) router.back()
    else void router.replace(parent())
  }
  useBackInterceptor(ref(true), leave)
  return leave
}
