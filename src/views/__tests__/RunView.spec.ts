import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { TrackPoint } from '@/lib/geo'
import { GpsError, startGps } from '@/lib/gps'
import { createMemoryRunRepository } from '@/lib/db/memoryRunRepository'
import { unavailableTrainingRepository } from '@/lib/db/trainingRepository'
import { setFollowedProgram } from '@/lib/settings'
import { useRunStore } from '@/stores/run'
import { useTrainingStore } from '@/stores/training'
import RunView from '../RunView.vue'

vi.mock('@capacitor-community/keep-awake', () => ({
  KeepAwake: {
    isSupported: async () => ({ isSupported: false }),
    keepAwake: async () => {},
    allowSleep: async () => {},
  },
}))

// Capture the callbacks the view hands to GPS, so the test plays the GPS
const gps = vi.hoisted(() => ({
  onPoint: null as ((p: TrackPoint) => void) | null,
  onError: null as ((e: Error) => void) | null,
  stop: vi.fn<() => void>(),
}))
vi.mock('@/lib/gps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/gps')>()),
  startGps: vi.fn<
    (onPoint: (p: TrackPoint) => void, onError: (e: Error) => void) => Promise<() => void>
  >(async (onPoint: (p: TrackPoint) => void, onError: (e: Error) => void) => {
    gps.onPoint = onPoint
    gps.onError = onError
    return gps.stop
  }),
  openAppSettings: vi.fn<() => Promise<void>>(async () => {}),
}))

const nav = vi.hoisted(() => ({
  push: vi.fn<(to: unknown) => Promise<void>>(async () => {}),
  query: {} as Record<string, string>,
}))
vi.mock('vue-router', () => ({ useRouter: () => nav, useRoute: () => ({ query: nav.query }) }))

const button = (wrapper: ReturnType<typeof mount>, label: string) =>
  wrapper.findAll('button').find((b) => b.text() === label)

async function start(wrapper: ReturnType<typeof mount>) {
  await button(wrapper, 'Start')!.trigger('click')
  await flushPromises()
}

// A screen left mounted would keep watching the shared settings and reach into the next test
enableAutoUnmount(afterEach)

describe('RunView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    nav.query = {}
    setFollowedProgram(null)
  })

  it('walks through start, pause, resume and stop', async () => {
    const wrapper = mount(RunView)
    expect(wrapper.text()).toContain('00:00')

    await start(wrapper)
    expect(wrapper.attributes('data-status')).toBe('running')
    expect(button(wrapper, 'Stop')).toBeUndefined() // can't stop by accident mid-run

    await button(wrapper, 'Pause')!.trigger('click')
    expect(wrapper.attributes('data-status')).toBe('paused')
    expect(gps.stop).not.toHaveBeenCalled() // GPS stays on while paused

    await button(wrapper, 'Resume')!.trigger('click')
    expect(wrapper.attributes('data-status')).toBe('running')

    await button(wrapper, 'Pause')!.trigger('click')
    const id = useRunStore().runId
    await button(wrapper, 'Stop')!.trigger('click')
    await flushPromises()
    expect(gps.stop).toHaveBeenCalledOnce()
    // The run is saved and cleared, and its summary opens
    expect(wrapper.attributes('data-status')).toBe('idle')
    expect(nav.push).toHaveBeenCalledWith({ name: 'run-summary', params: { id } })
  })

  it('shows "Acquiring GPS" until the first usable fix', async () => {
    const wrapper = mount(RunView)
    await start(wrapper)
    expect(wrapper.text()).toContain('Acquiring GPS')

    gps.onPoint!({ lat: 52, lon: 4, timestamp: Date.now(), accuracy: 80 }) // too inaccurate
    await flushPromises()
    expect(wrapper.text()).toContain('Acquiring GPS')

    gps.onPoint!({ lat: 52, lon: 4, timestamp: Date.now(), accuracy: 5 })
    await flushPromises()
    expect(wrapper.text()).not.toContain('Acquiring GPS')
  })

  it('goes back to idle with a settings button when location is refused', async () => {
    const wrapper = mount(RunView)
    await start(wrapper)
    gps.onError!(new GpsError('denied', 'User denied location permission'))
    await flushPromises()

    expect(wrapper.attributes('data-status')).toBe('idle')
    expect(wrapper.text()).toContain('Location permission is needed')
    expect(button(wrapper, 'Open settings')).toBeDefined()
  })

  it('keeps a run in progress when location goes off mid-run', async () => {
    const wrapper = mount(RunView)
    await start(wrapper)
    gps.onPoint!({ lat: 52, lon: 4, timestamp: Date.now(), accuracy: 5 })
    gps.onError!(new GpsError('disabled', 'Location services disabled.'))
    await flushPromises()

    expect(wrapper.attributes('data-status')).toBe('running')
    expect(wrapper.text()).toContain('Location is off')
  })

  it('deletes the run when location is refused before the first fix', async () => {
    const repo = createMemoryRunRepository()
    useRunStore().useRepository(repo)
    const wrapper = mount(RunView)
    await start(wrapper)
    gps.onError!(new GpsError('denied', 'User denied location permission'))
    await flushPromises()
    expect(await repo.findUnfinished()).toEqual([])
  })

  it('saves the run on Stop before opening its summary', async () => {
    const repo = createMemoryRunRepository()
    const run = useRunStore()
    run.useRepository(repo)
    const wrapper = mount(RunView)
    await start(wrapper)
    gps.onPoint!({ lat: 52, lon: 4, timestamp: Date.now(), accuracy: 5 })
    const id = run.runId!
    await button(wrapper, 'Pause')!.trigger('click')
    await button(wrapper, 'Stop')!.trigger('click')
    await flushPromises()

    expect((await repo.getRun(id))?.status).toBe('finished')
    expect(await repo.loadPoints(id)).toHaveLength(1)
  })

  it('stays on the run screen, paused, when saving on Stop fails', async () => {
    const repo = createMemoryRunRepository()
    const run = useRunStore()
    run.useRepository({ ...repo, updateRun: vi.fn<() => Promise<void>>().mockRejectedValue(new Error('disk full')) })
    const wrapper = mount(RunView)
    await start(wrapper)
    await button(wrapper, 'Pause')!.trigger('click')
    await button(wrapper, 'Stop')!.trigger('click')
    await flushPromises()

    expect(nav.push).not.toHaveBeenCalled()
    expect(wrapper.attributes('data-status')).toBe('paused')
    expect(wrapper.text()).toContain('Not saving')
    expect(button(wrapper, 'Stop')).toBeDefined() // can try again
  })

  it('shows a recovered run and starts GPS on Resume', async () => {
    const repo = createMemoryRunRepository()
    await repo.createRun({
      id: 'r1',
      name: null,
      status: 'running',
      startedAt: 0,
      finishedAt: null,
      elapsedMs: 0,
      segment: 0,
      segmentStartedAt: 0,
      movingMs: 0,
      distanceM: 0,
      sessionId: null,
    })
    await repo.addPoint('r1', 0, { lat: 52, lon: 4, timestamp: 1000, accuracy: 5 })
    const run = useRunStore()
    run.useRepository(repo)
    await run.recover()

    const wrapper = mount(RunView)
    expect(wrapper.attributes('data-status')).toBe('paused')
    expect(wrapper.text()).toContain('Run recovered')
    expect(startGps).not.toHaveBeenCalled()

    await button(wrapper, 'Resume')!.trigger('click')
    await flushPromises()
    expect(wrapper.attributes('data-status')).toBe('running')
    expect(startGps).toHaveBeenCalledOnce()
    expect(wrapper.text()).not.toContain('Run recovered')
  })

  describe('training sessions (#40)', () => {
    /** A followed program: week 1 easy (done when `doneFirst`), a rest day, week 2 intervals */
    async function followed({ doneFirst = false, follow = true } = {}) {
      const training = useTrainingStore()
      const run = useRunStore()
      const programId = await training.createProgram({
        name: 'Half marathon',
        goal: null,
        weeks: 2,
        startDate: null,
      })
      const easy = await training.saveSession(programId, {
        week: 1,
        type: 'easy',
        title: '30 min easy',
        notes: null,
      })
      await training.saveSession(programId, { week: 1, type: 'rest', title: 'Rest', notes: null })
      const intervals = await training.saveSession(programId, {
        week: 2,
        type: 'intervals',
        title: '6×400 m',
        notes: null,
      })
      if (doneFirst) run.start(0, easy)
      if (doneFirst) await run.finish(1_000)
      if (follow) setFollowedProgram(programId)
      return { programId, easy, intervals }
    }

    it('offers the next session of the followed program next to a free run', async () => {
      const { easy } = await followed()
      const wrapper = mount(RunView)
      await flushPromises()
      expect(wrapper.text()).toContain('Next session · Week 1')
      expect(wrapper.text()).toContain('30 min easy')
      expect(wrapper.text()).toContain('Half marathon')
      expect(button(wrapper, 'Free run')).toBeDefined()

      await button(wrapper, 'Start session')!.trigger('click')
      await flushPromises()
      expect(useRunStore().sessionId).toBe(easy)
      expect(wrapper.text()).toContain('Week 1 · 30 min easy')
    })

    it('moves on to the next session once one is done, skipping rest days', async () => {
      await followed({ doneFirst: true })
      const wrapper = mount(RunView)
      await flushPromises()
      expect(wrapper.text()).toContain('Next session · Week 2')
      expect(wrapper.text()).toContain('6×400 m')
    })

    it('starts a free run without a link', async () => {
      await followed()
      const wrapper = mount(RunView)
      await flushPromises()
      await button(wrapper, 'Free run')!.trigger('click')
      await flushPromises()
      expect(useRunStore().status).toBe('running')
      expect(useRunStore().sessionId).toBeNull()
    })

    it('offers the session picked with "Run this session", even when it is not the next one', async () => {
      const { intervals } = await followed({ follow: false })
      nav.query = { session: intervals }
      const wrapper = mount(RunView)
      await flushPromises()
      expect(wrapper.text()).toContain('Session · Week 2')
      await button(wrapper, 'Start session')!.trigger('click')
      await flushPromises()
      expect(useRunStore().sessionId).toBe(intervals)
    })

    it('says when every session is done, and offers a plain Start', async () => {
      const { intervals } = await followed({ doneFirst: true })
      const run = useRunStore()
      run.start(2_000, intervals)
      await run.finish(3_000)
      const wrapper = mount(RunView)
      await flushPromises()
      expect(wrapper.text()).toContain('All sessions done')
      expect(button(wrapper, 'Start')).toBeDefined()
      expect(button(wrapper, 'Start session')).toBeUndefined()
    })

    it('points to Training when no program is followed', async () => {
      const wrapper = mount(RunView)
      await flushPromises()
      expect(wrapper.text()).toContain('Follow a program in Training')
      expect(button(wrapper, 'Start')).toBeDefined()
    })

    it('still starts a free run when the programs cannot be read', async () => {
      useTrainingStore().useRepository(unavailableTrainingRepository('broken'))
      setFollowedProgram('p')
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const wrapper = mount(RunView)
      await flushPromises()
      expect(wrapper.find('.session-card').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Follow a program')
      await start(wrapper)
      expect(useRunStore().status).toBe('running')
    })
  })

  it('warns when the run is not being saved', async () => {
    const run = useRunStore()
    const wrapper = mount(RunView)
    run.saveError = true
    await flushPromises()
    expect(wrapper.text()).toContain('Not saving')
  })
})
