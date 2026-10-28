import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useRunStore } from '@/stores/run'
import type { CueConfig } from '@/lib/cues'

const speak = vi.hoisted(() => vi.fn<(t: string) => Promise<void>>(async () => {}))
vi.mock('@/lib/speech', () => ({ speak }))

import { useAudioCues } from '../useAudioCues'

const config = ref<CueConfig>({ distanceKm: 1, timeMin: 0 })

function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const run = useRunStore()
  mount(
    defineComponent({
      setup() {
        useAudioCues(config)
        return () => null
      },
    }),
    { global: { plugins: [pinia] } },
  )
  return run
}

beforeEach(() => {
  speak.mockClear()
  config.value = { distanceKm: 1, timeMin: 0 }
})

describe('useAudioCues', () => {
  it('speaks at each km of a running run', async () => {
    const run = setup()
    run.start(0)
    await nextTick()
    run.distanceM = 1005
    run.tick(330_000)
    await nextTick()
    expect(speak).toHaveBeenCalledOnce()
    expect(speak.mock.calls[0]![0]).toContain('1 kilometre')
  })

  it('stays silent while paused and does not repeat after the resume', async () => {
    const run = setup()
    run.start(0)
    await nextTick()
    run.distanceM = 1005
    run.tick(330_000)
    await nextTick()
    speak.mockClear()
    run.pause(330_000)
    await nextTick()
    run.resume(900_000)
    run.tick(900_000)
    await nextTick()
    expect(speak).not.toHaveBeenCalled()
  })

  it('does nothing when both triggers are off', async () => {
    config.value = { distanceKm: 0, timeMin: 0 }
    const run = setup()
    run.start(0)
    await nextTick()
    run.distanceM = 5000
    run.tick(2_000_000)
    await nextTick()
    expect(speak).not.toHaveBeenCalled()
  })
})
