import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MotionReading } from '../runPower'

const native = vi.hoisted(() => ({ value: true }))
/** What the fake plugin saw, and what it answers */
const state = vi.hoisted(() => ({
  listener: null as ((r: { at: number; level?: number; samples: number }) => void) | null,
  removed: 0,
  available: true,
}))
const plugin = vi.hoisted(() => ({
  addListener: vi.fn<
    (
      event: string,
      listener: (r: MotionReading) => void,
    ) => Promise<{ remove: () => Promise<void> }>
  >(async (_event, listener) => {
    state.listener = listener
    return { remove: async () => void state.removed++ }
  }),
  startMotion: vi.fn<() => Promise<{ available: boolean }>>(async () => ({
    available: state.available,
  })),
  stopMotion: vi.fn<() => Promise<void>>(async () => {}),
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.value },
  registerPlugin: () => plugin,
}))

import { watchMotion } from '../runPower'

/** Let the async start inside watchMotion finish */
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  native.value = true
  state.listener = null
  state.removed = 0
  state.available = true
  vi.clearAllMocks()
})

describe('watchMotion (#154)', () => {
  it('does nothing off the phone', async () => {
    native.value = false
    const stop = watchMotion(() => {})
    await settle()
    stop()
    expect(plugin.startMotion).not.toHaveBeenCalled()
    expect(plugin.stopMotion).not.toHaveBeenCalled()
  })

  it('passes readings on until stopped, then stops the sensor', async () => {
    const readings: MotionReading[] = []
    const stop = watchMotion((r) => readings.push(r))
    await settle()
    expect(plugin.startMotion).toHaveBeenCalledOnce()
    state.listener!({ at: 1, level: 2.5, samples: 100 })
    stop()
    state.listener!({ at: 2, level: 3, samples: 100 })
    expect(readings).toEqual([{ at: 1, level: 2.5, samples: 100 }])
    expect(state.removed).toBe(1)
    expect(plugin.stopMotion).toHaveBeenCalledOnce()
  })

  it('leaves the sensor off when stopped before it has started', async () => {
    const stop = watchMotion(() => {})
    stop()
    await settle()
    // Whatever order the calls land in, the last word is stop
    const last = (order: number[]) => order[order.length - 1] ?? 0
    const lastStart = last(plugin.startMotion.mock.invocationCallOrder)
    const lastStop = last(plugin.stopMotion.mock.invocationCallOrder)
    expect(lastStop).toBeGreaterThan(lastStart)
  })

  it('never throws when the sensor is missing', async () => {
    state.available = false
    const stop = watchMotion(() => {})
    await settle()
    expect(() => stop()).not.toThrow()
  })
})
