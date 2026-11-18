import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useRunStore } from '@/stores/run'
import type { RunStep } from '@/lib/stepProgress'

const speech = vi.hoisted(() => ({
  speak: vi.fn<(t: string) => Promise<void>>(async () => {}),
  speaking: false,
}))
vi.mock('@/lib/speech', () => ({ speak: speech.speak, isSpeaking: () => speech.speaking }))

import { usePaceCoach } from '../usePaceCoach'

const enabled = ref(true)

const runStep: RunStep = {
  position: 0,
  kind: 'run',
  targetKind: 'none',
  targetValue: null,
  paceMin: 330,
  paceMax: 360,
  repetition: null,
  repetitions: null,
  startedElapsedMs: 0,
  startedDistanceM: 0,
  endedElapsedMs: null,
  endedDistanceM: null,
}

function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const run = useRunStore()
  mount(
    defineComponent({
      setup() {
        usePaceCoach(enabled, ref(540))
        return () => null
      },
    }),
    { global: { plugins: [pinia] } },
  )
  return run
}

/** Run on for this many seconds at 7:00 /km, one tick a second */
async function runSlow(run: ReturnType<typeof useRunStore>, seconds: number) {
  const from = run.elapsedMs / 1000
  for (let s = from + 1; s <= from + seconds; s++) {
    run.distanceM = (s * 1000) / 420
    run.tick(s * 1000)
    await nextTick()
  }
}

beforeEach(() => {
  speech.speak.mockClear()
  speech.speaking = false
  enabled.value = true
})

describe('usePaceCoach', () => {
  it('says "Faster" on a session step run too slowly', async () => {
    const run = setup()
    run.start(0)
    run.runSteps = [runStep]
    await nextTick()
    await runSlow(run, 50)
    expect(speech.speak).toHaveBeenCalledExactlyOnceWith('Faster')
  })

  it('stays silent when switched off, and on a free run', async () => {
    enabled.value = false
    const run = setup()
    run.start(0)
    run.runSteps = [runStep]
    await nextTick()
    await runSlow(run, 50)
    expect(speech.speak).not.toHaveBeenCalled()

    enabled.value = true
    run.runSteps = []
    await runSlow(run, 50)
    expect(speech.speak).not.toHaveBeenCalled()
  })

  it('waits for other speech to end', async () => {
    const run = setup()
    run.start(0)
    run.runSteps = [runStep]
    await nextTick()
    speech.speaking = true
    await runSlow(run, 50)
    expect(speech.speak).not.toHaveBeenCalled()
    speech.speaking = false
    await runSlow(run, 1)
    expect(speech.speak).toHaveBeenCalledExactlyOnceWith('Faster')
  })
})
