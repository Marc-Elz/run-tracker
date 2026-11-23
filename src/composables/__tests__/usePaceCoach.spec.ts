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
import type { SessionType } from '@/lib/training'

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

const walkFloor = ref<number | null>(null)
const sessionType = ref<SessionType | null>(null)
const breaks = ref(false)

function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const run = useRunStore()
  mount(
    defineComponent({
      setup() {
        usePaceCoach(enabled, ref(540), { floor: walkFloor, sessionType, breaks })
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

/** Wall clock for `go`, in ms */
let clock = 0

/** Go on for this many seconds at `secPerKm` (0: standing), one tick a second */
async function go(run: ReturnType<typeof useRunStore>, seconds: number, secPerKm: number) {
  for (let i = 0; i < seconds; i++) {
    if (secPerKm > 0) run.distanceM += 1000 / secPerKm
    clock += 1000
    run.tick(clock)
    await nextTick()
  }
}

beforeEach(() => {
  speech.speak.mockClear()
  speech.speaking = false
  enabled.value = true
  walkFloor.value = null
  sessionType.value = null
  breaks.value = false
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

  it('does not judge the stop before a pause once the run resumes (#154)', async () => {
    const run = setup()
    clock = 0
    run.start(clock)
    run.runSteps = [runStep]
    await nextTick()
    await go(run, 40, 345) // on pace
    await go(run, 4, 0) // standing at a light for the auto-pause hold
    run.pause(clock)
    await nextTick()
    clock += 60_000
    run.resume(clock)
    await nextTick()
    await go(run, 30, 345)
    expect(run.elapsedMs).toBe(74_000)
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

  describe('walk steps (#153)', () => {
    const walkStep: RunStep = { ...runStep, kind: 'walk', paceMin: null, paceMax: null }

    /** A walk step at 12:00 /km against a 10:30 floor, in a session of this type */
    async function stroll(type: SessionType) {
      walkFloor.value = 630
      sessionType.value = type
      const run = setup()
      clock = 0
      run.start(clock)
      run.runSteps = [walkStep]
      await nextTick()
      await go(run, 50, 720)
    }

    it('says "Faster" on a walk step slower than the walk floor in a walk session', async () => {
      await stroll('walk')
      expect(speech.speak).toHaveBeenCalledExactlyOnceWith('Faster')
    })

    it('coaches run/walk breaks only with "Also during run/walk breaks" on', async () => {
      await stroll('runwalk')
      expect(speech.speak).not.toHaveBeenCalled()
      breaks.value = true
      await stroll('runwalk')
      expect(speech.speak).toHaveBeenCalledExactlyOnceWith('Faster')
    })

    it('never uses the floor in other sessions', async () => {
      breaks.value = true
      await stroll('easy')
      expect(speech.speak).not.toHaveBeenCalled()
    })

    it('coaches a walk step with its own pace in any session', async () => {
      sessionType.value = 'runwalk'
      const run = setup()
      clock = 0
      run.start(clock)
      run.runSteps = [{ ...walkStep, paceMin: 540, paceMax: 600 }]
      await nextTick()
      await go(run, 50, 480)
      expect(speech.speak).toHaveBeenCalledExactlyOnceWith('Slower')
    })
  })
})
