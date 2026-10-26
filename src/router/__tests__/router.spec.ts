import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useRunStore } from '@/stores/run'
import router from '../index'

describe('router', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await router.push('/')
  })

  it('has Run, History and Settings routes', async () => {
    for (const name of ['run', 'history', 'settings']) {
      await router.push({ name })
      expect(router.currentRoute.value.name).toBe(name)
    }
  })

  it('keeps you on the run screen while a run is running, paused or finished', async () => {
    const run = useRunStore()
    run.start(0)
    await router.push('/history')
    expect(router.currentRoute.value.name).toBe('run')
    run.pause(1000)
    await router.push('/settings')
    expect(router.currentRoute.value.name).toBe('run')
    run.stop(2000)
    await router.push('/settings')
    expect(router.currentRoute.value.name).toBe('run')
    run.reset()
    await router.push('/settings')
    expect(router.currentRoute.value.name).toBe('settings')
  })
})
