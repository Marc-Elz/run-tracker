import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { TimerPreset } from '@/lib/timer'

const speak = vi.hoisted(() => vi.fn<(t: string) => Promise<void>>(async () => {}))
const vibrate = vi.hoisted(() => vi.fn<() => Promise<void>>(async () => {}))
const keepAlive = vi.hoisted(() => vi.fn<(keep: boolean) => Promise<void>>(async () => {}))
const keepAwake = vi.hoisted(() => ({ active: null as Ref<boolean> | null }))
vi.mock('@/lib/speech', () => ({ speak }))
vi.mock('@/lib/haptics', () => ({ vibrateStepChange: vibrate }))
vi.mock('@/lib/runPower', () => ({ keepWebViewAlive: keepAlive }))
vi.mock('@/composables/useKeepAwake', () => ({
  useKeepAwake: (active: Ref<boolean>) => (keepAwake.active = active),
}))

import { useCountdown } from '../useCountdown'

const plank: TimerPreset = { id: 'p', name: 'Plank set', workS: 45, restS: 15, rounds: 2 }
const twoMin: TimerPreset = { id: 'default', name: '2 minutes', workS: 120, restS: 0, rounds: 1 }

function setup() {
  let countdown!: ReturnType<typeof useCountdown>
  const wrapper = mount(
    defineComponent({
      setup() {
        countdown = useCountdown(() => 0)
        return () => null
      },
    }),
  )
  return { countdown, wrapper }
}

const spoken = () => speak.mock.calls.map((c) => c[0])

beforeEach(() => {
  vi.useFakeTimers()
  speak.mockClear()
  vibrate.mockClear()
  keepAlive.mockClear()
})

describe('useCountdown', () => {
  it('counts the 2-minute default down to done, with Go and Done spoken', () => {
    const { countdown } = setup()
    countdown.start(twoMin, 0)
    expect(countdown.state.value.remainingMs).toBe(120_000)
    countdown.tick(30_000)
    expect(countdown.state.value.remainingMs).toBe(90_000)
    countdown.tick(120_000)
    expect(countdown.status.value).toBe('done')
    expect(spoken()).toEqual(['Go', 'Done'])
    expect(vibrate).toHaveBeenCalledTimes(2)
  })

  it('cues each phase change once', () => {
    const { countdown } = setup()
    countdown.start(plank, 0)
    countdown.tick(45_000)
    countdown.tick(46_000)
    countdown.tick(60_000)
    countdown.tick(61_000)
    countdown.tick(105_000)
    expect(spoken()).toEqual(['Round 1 of 2, work', 'Rest', 'Round 2 of 2, work', 'Done'])
  })

  it('catches up after the page was held back, cueing only the current phase', () => {
    const { countdown } = setup()
    countdown.start(plank, 0)
    countdown.tick(70_000)
    expect(countdown.state.value).toEqual({ index: 2, remainingMs: 35_000, done: false })
    expect(spoken()).toEqual(['Round 1 of 2, work', 'Round 2 of 2, work'])
  })

  it('does not count paused time', () => {
    const { countdown } = setup()
    countdown.start(twoMin, 0)
    countdown.pause(20_000)
    expect(countdown.status.value).toBe('paused')
    countdown.tick(500_000)
    expect(countdown.state.value.remainingMs).toBe(100_000)
    countdown.resume(500_000)
    countdown.tick(510_000)
    expect(countdown.state.value.remainingMs).toBe(90_000)
  })

  it('ticks on its own while running', () => {
    let t = 0
    const wrapper = mount(
      defineComponent({
        setup() {
          const c = useCountdown(() => t)
          c.start(twoMin)
          return { c }
        },
        render: () => null,
      }),
    )
    t = 121_000
    vi.advanceTimersByTime(250)
    expect(wrapper.vm.c.status.value).toBe('done')
  })

  it('keeps the screen on and the page alive only while running', async () => {
    const { countdown, wrapper } = setup()
    expect(keepAwake.active?.value).toBe(false)
    countdown.start(twoMin, 0)
    await nextTick()
    expect(keepAwake.active?.value).toBe(true)
    expect(keepAlive).toHaveBeenLastCalledWith(true)
    countdown.pause(1000)
    await nextTick()
    expect(keepAwake.active?.value).toBe(false)
    expect(keepAlive).toHaveBeenLastCalledWith(false)
    countdown.resume(1000)
    await nextTick()
    wrapper.unmount()
    expect(keepAlive).toHaveBeenLastCalledWith(false)
  })

  it('stop goes back to idle with nothing kept', () => {
    const { countdown } = setup()
    countdown.start(plank, 0)
    countdown.stop()
    expect(countdown.status.value).toBe('idle')
    expect(countdown.preset.value).toBeNull()
  })
})
