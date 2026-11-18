import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useRunStore } from '@/stores/run'

const speech = vi.hoisted(() => ({
  speak: vi.fn<(t: string) => Promise<void>>(async () => {}),
  speaking: false,
}))
vi.mock('@/lib/speech', () => ({ speak: speech.speak, isSpeaking: () => speech.speaking }))

import { useAutoPause } from '../useAutoPause'

const enabled = ref(true)
const M_PER_DEG = 111_320

function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const run = useRunStore()
  let onFix: ReturnType<typeof useAutoPause>['onFix'] = () => {}
  mount(
    defineComponent({
      setup() {
        onFix = useAutoPause(enabled).onFix
        return () => null
      },
    }),
    { global: { plugins: [pinia] } },
  )
  return { run, onFix: (p: Parameters<typeof onFix>[0]) => onFix(p) }
}

type Fix = ReturnType<typeof setup>['onFix']

/** One fix a second from `from` to `to`, at `mps` north of `startM`; GPS speed matches */
async function move(onFix: Fix, from: number, to: number, startM: number, mps: number) {
  for (let s = from; s <= to; s++) {
    vi.setSystemTime(s * 1000)
    const north = startM + (s - from) * mps
    onFix({ lat: 52 + north / M_PER_DEG, lon: 4, timestamp: s * 1000, accuracy: 5, speed: mps })
    await nextTick()
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  speech.speak.mockClear()
  speech.speaking = false
  enabled.value = true
})
afterEach(() => vi.useRealTimers())

describe('useAutoPause', () => {
  it('pauses at a stop and resumes on moving, saying so', async () => {
    const { run, onFix } = setup()
    run.start(0)
    await nextTick()
    await move(onFix, 0, 20, 0, 3)
    await move(onFix, 21, 30, 60, 0)
    expect(run.status).toBe('paused')
    expect(run.pauseKind).toBe('auto')
    expect(speech.speak).toHaveBeenCalledExactlyOnceWith('Stop detected')

    await move(onFix, 31, 40, 60, 3)
    expect(run.status).toBe('running')
    expect(speech.speak).toHaveBeenLastCalledWith('Resumed')
  })

  it('"Stop detected" waits for other speech to end', async () => {
    const { run, onFix } = setup()
    run.start(0)
    await nextTick()
    await move(onFix, 0, 20, 0, 3)
    speech.speaking = true
    await move(onFix, 21, 26, 60, 0)
    expect(run.pauseKind).toBe('auto')
    expect(speech.speak).not.toHaveBeenCalled()
    speech.speaking = false
    vi.advanceTimersByTime(300)
    expect(speech.speak).toHaveBeenCalledExactlyOnceWith('Stop detected')
  })

  it('leaves "Resumed" out when another line is playing as the run resumes', async () => {
    const { run, onFix } = setup()
    run.start(0)
    await nextTick()
    await move(onFix, 0, 20, 0, 3)
    await move(onFix, 21, 30, 60, 0)
    speech.speak.mockClear()
    speech.speaking = true // a step announcement at the resume
    await move(onFix, 31, 40, 60, 3)
    expect(run.status).toBe('running')
    vi.advanceTimersByTime(5000)
    expect(speech.speak).not.toHaveBeenCalled()
  })

  it('a manual pause always wins: Pause during an auto-pause never resumes by itself', async () => {
    const { run, onFix } = setup()
    run.start(0)
    await nextTick()
    await move(onFix, 0, 20, 0, 3)
    await move(onFix, 21, 30, 60, 0)
    run.holdPause() // Pause tapped on the auto-paused screen
    await nextTick()
    await move(onFix, 31, 50, 60, 3)
    expect(run.status).toBe('paused')
    expect(run.pauseKind).toBe('manual')
  })

  it('never auto-pauses right after a manual Resume until moving was seen', async () => {
    const { run, onFix } = setup()
    run.start(0)
    await nextTick()
    await move(onFix, 0, 20, 0, 3)
    run.pause(21_000)
    await nextTick()
    run.resume(40_000)
    await nextTick()
    await move(onFix, 40, 60, 60, 0) // still standing after Resume
    expect(run.status).toBe('running')
    await move(onFix, 61, 70, 60, 3)
    await move(onFix, 71, 80, 90, 0)
    expect(run.pauseKind).toBe('auto')
  })

  it('does nothing when switched off, and a switch-off while auto-paused holds the pause', async () => {
    const { run, onFix } = setup()
    run.start(0)
    await nextTick()
    await move(onFix, 0, 20, 0, 3)
    await move(onFix, 21, 30, 60, 0)
    expect(run.pauseKind).toBe('auto')
    enabled.value = false
    await nextTick()
    expect(run.pauseKind).toBe('manual')
    run.resume(31_000)
    await nextTick()
    await move(onFix, 31, 40, 60, 3)
    await move(onFix, 41, 60, 90, 0)
    expect(run.status).toBe('running')
  })
})
