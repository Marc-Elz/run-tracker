import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryRunRepository } from '@/lib/db/memoryRunRepository'
import type { RunRecord } from '@/lib/db/runRepository'
import { useRunStore } from '@/stores/run'
import { useTrainingStore } from '@/stores/training'
import { formatClock } from '@/lib/format'
import type { SessionStep } from '@/lib/training'
import RunSummaryView from '../RunSummaryView.vue'

const nav = vi.hoisted(() => ({
  params: { id: 'r1' },
  replace: vi.fn<(to: unknown) => Promise<void>>(async () => {}),
  back: vi.fn<() => void>(),
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: nav.params }),
  useRouter: () => nav,
}))

const share = vi.hoisted(() => ({
  shareGpx: vi.fn<(fileName: string, xml: string) => Promise<void>>(async () => {}),
}))
vi.mock('@/lib/shareRun', () => share)

// MapLibre needs WebGL, which jsdom does not have; the map has its own checks in the browser
const RouteMap = {
  props: ['route', 'pauses', 'selected', 'lostSpot'],
  emits: ['select-pause'],
  template: `<div>
    <div class="map-stub" :data-pauses="(pauses ?? []).length" :data-selected="selected" :data-lost="lostSpot ? lostSpot.join(',') : ''">{{ route.lines.length }}</div>
    <button class="dot-stub" @click="$emit('select-pause', 1)">dot</button>
  </div>`,
}

const record: RunRecord = {
  id: 'r1',
  name: null,
  status: 'finished',
  startedAt: Date.UTC(2026, 9, 26, 7, 12),
  finishedAt: Date.UTC(2026, 9, 26, 7, 40),
  elapsedMs: 3000,
  segment: 0,
  segmentStartedAt: null,
  movingMs: 3000,
  distanceM: 33,
  sessionId: null,
  recordingLostAt: null,
}

const button = (wrapper: ReturnType<typeof mount>, label: string) =>
  wrapper.findAll('button').find((b) => b.text() === label)
const dialogButton = (wrapper: ReturnType<typeof mount>, label: string) =>
  wrapper
    .find('.dialog')
    .findAll('button')
    .find((b) => b.text() === label)

async function open(seed = true) {
  const repo = createMemoryRunRepository()
  if (seed) {
    await repo.createRun(record)
    for (let i = 0; i < 4; i++) {
      await repo.addPoint('r1', 0, {
        lat: 52 + i * 0.0001,
        lon: 4,
        timestamp: i * 2000,
        accuracy: 5,
      })
    }
  }
  useRunStore().useRepository(repo)
  const wrapper = mount(RunSummaryView, { global: { stubs: { RouteMap } } })
  await flushPromises()
  return { wrapper, repo }
}

describe('RunSummaryView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows distance, time, moving time and average pace with the route', async () => {
    const { wrapper } = await open()
    const text = wrapper.text()
    expect(text).toContain('0.03') // km from the raw points
    expect(text).toContain('00:03') // elapsed
    expect(text).toContain('00:06') // moving
    expect(text).toMatch(/\d+:\d{2}/) // pace
    expect(wrapper.find('.map-stub').text()).toBe('1')
  })

  it('lists the splits, ending with the partial km', async () => {
    const { wrapper } = await open()
    const rows = wrapper.findAll('.split')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.text()).toContain('0.03 km')
  })

  describe('auto-pauses (#154)', () => {
    const pause = (position: number, startedAt: number, endedAt: number) => ({
      position,
      kind: 'auto' as const,
      startedAt,
      endedAt,
      startedElapsedMs: 0,
      lat: 52,
      lon: 4,
    })

    it('lists each auto-pause with its time and length, and the total', async () => {
      const repo = createMemoryRunRepository()
      await repo.importRun(
        record,
        [],
        [],
        [
          pause(0, Date.UTC(2026, 9, 26, 7, 20, 5), Date.UTC(2026, 9, 26, 7, 20, 30)),
          pause(1, Date.UTC(2026, 9, 26, 7, 31), Date.UTC(2026, 9, 26, 7, 32, 10)),
        ],
      )
      useRunStore().useRepository(repo)
      const wrapper = mount(RunSummaryView, { global: { stubs: { RouteMap } } })
      await flushPromises()
      const section = wrapper.get('[aria-label="Auto-pauses"]')
      expect(section.text()).toContain('2 · 01:35 not counted')
      const rows = section.findAll('button.pause')
      const clock = (t: number) =>
        new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      expect(rows.map((r) => r.findAll('span').map((span) => span.text()))).toEqual([
        ['', `1 · ${clock(Date.UTC(2026, 9, 26, 7, 20, 5))}`, '00:25'],
        ['', `2 · ${clock(Date.UTC(2026, 9, 26, 7, 31))}`, '01:10'],
      ])
      expect(wrapper.get('.map-stub').attributes('data-pauses')).toBe('2')
    })

    it('shows a pause on the map from its row or its dot, and lets go on a second tap', async () => {
      const repo = createMemoryRunRepository()
      await repo.importRun(record, [], [], [pause(0, 1_000, 2_000), pause(1, 5_000, 9_000)])
      useRunStore().useRepository(repo)
      const wrapper = mount(RunSummaryView, { global: { stubs: { RouteMap } } })
      await flushPromises()
      const rows = () => wrapper.findAll('button.pause')
      await rows()[0]!.trigger('click')
      expect(rows()[0]!.attributes('aria-pressed')).toBe('true')
      expect(wrapper.get('.map-stub').attributes('data-selected')).toBe('0')
      await rows()[0]!.trigger('click')
      expect(rows()[0]!.attributes('aria-pressed')).toBe('false')
      // A tap on a dot selects its row
      await wrapper.get('.dot-stub').trigger('click')
      expect(rows()[1]!.attributes('aria-pressed')).toBe('true')
    })

    it('has no auto-pause section for a run without any', async () => {
      const { wrapper } = await open()
      expect(wrapper.find('[aria-label="Auto-pauses"]').exists()).toBe(false)
    })
  })

  describe('recording lost (#81)', () => {
    it('says when recording stopped and marks the spot on the map', async () => {
      const { repo, wrapper: plain } = await open()
      expect(plain.find('[role="note"]').exists()).toBe(false)
      expect(plain.find('.map-stub').attributes('data-lost')).toBe('')
      plain.unmount()

      await repo.updateRun({ ...record, recordingLostAt: 6000 })
      const wrapper = mount(RunSummaryView, { global: { stubs: { RouteMap } } })
      await flushPromises()
      expect(wrapper.find('[role="note"]').text()).toBe(
        `Recording stopped at ${formatClock(6000)}: the app was closed.`,
      )
      expect(wrapper.find('.map-stub').attributes('data-lost')).toBe(`4,${52 + 3 * 0.0001}`)
    })

    it('gives the gap when the run was resumed after it', async () => {
      const { repo } = await open()
      await repo.addPoint('r1', 1, { lat: 52.001, lon: 4, timestamp: 600_000, accuracy: 5 })
      await repo.updateRun({ ...record, segment: 1, recordingLostAt: 6000 })
      const wrapper = mount(RunSummaryView, { global: { stubs: { RouteMap } } })
      await flushPromises()
      expect(wrapper.find('[role="note"]').text()).toBe(
        `No recording from ${formatClock(6000)} to ${formatClock(600_000)}: the app was closed.`,
      )
    })
  })

  it('titles an unnamed run by its date and renames it from the editor', async () => {
    const { wrapper, repo } = await open()
    expect(wrapper.find('.title__name').text()).toContain('·')
    expect(wrapper.find('.title__when').exists()).toBe(false)

    await button(wrapper, 'Rename')!.trigger('click')
    expect(button(wrapper, 'Rename')).toBeUndefined()
    await wrapper.find('.rename__input').setValue('  Morning loop ')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('.rename').exists()).toBe(false)
    expect(wrapper.find('.title__name').text()).toBe('Morning loop')
    expect(wrapper.find('.title__when').text()).toContain('·')
    expect((await repo.getRun('r1'))?.name).toBe('Morning loop')
  })

  it('starts the editor on the current name and clears it when saved empty', async () => {
    const { wrapper, repo } = await open()
    await repo.renameRun('r1', 'Morning loop')
    await wrapper.unmount()
    const again = mount(RunSummaryView, { global: { stubs: { RouteMap } } })
    await flushPromises()
    expect(again.find('.title__name').text()).toBe('Morning loop')

    await button(again, 'Rename')!.trigger('click')
    expect((again.find('.rename__input').element as HTMLInputElement).value).toBe('Morning loop')
    await again.find('.rename__input').setValue('   ')
    await again.find('form').trigger('submit')
    await flushPromises()

    expect(again.find('.title__name').text()).toContain('·')
    expect((await repo.getRun('r1'))?.name).toBeNull()
  })

  it('cancels without saving', async () => {
    const { wrapper, repo } = await open()
    await button(wrapper, 'Rename')!.trigger('click')
    await wrapper.find('.rename__input').setValue('Nope')
    await button(wrapper, 'Cancel')!.trigger('click')
    expect(wrapper.find('.rename').exists()).toBe(false)
    expect((await repo.getRun('r1'))?.name).toBeNull()
  })

  it('keeps the editor open and the old name when saving fails', async () => {
    const { wrapper, repo } = await open()
    useRunStore().useRepository({
      ...repo,
      renameRun: vi.fn<() => Promise<never>>().mockRejectedValue(new Error('x')),
    })
    await button(wrapper, 'Rename')!.trigger('click')
    await wrapper.find('.rename__input').setValue('Morning loop')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Could not save the name')
    expect(wrapper.find('.rename').exists()).toBe(true)
    expect((await repo.getRun('r1'))?.name).toBeNull()
  })

  it('goes back in history, or to the Run tab right after Stop', async () => {
    window.history.replaceState({ back: '/history' }, '')
    const fromHistory = (await open()).wrapper
    await button(fromHistory, '‹ Back')!.trigger('click')
    expect(nav.back).toHaveBeenCalled()
    expect(nav.replace).not.toHaveBeenCalled()

    window.history.replaceState({}, '')
    const afterStop = (await open()).wrapper
    await button(afterStop, '‹ Back')!.trigger('click')
    expect(nav.replace).toHaveBeenCalledWith({ name: 'run' })
    expect(nav.back).toHaveBeenCalledOnce()
  })

  it('says so when the run does not exist', async () => {
    const { wrapper } = await open(false)
    expect(wrapper.text()).toContain('Run not found')
    await button(wrapper, 'Back to History')!.trigger('click')
    expect(nav.replace).toHaveBeenCalledWith({ name: 'history' })
  })

  it('offers a retry when the run cannot be loaded', async () => {
    const repo = createMemoryRunRepository()
    useRunStore().useRepository({
      ...repo,
      getRun: vi.fn<() => Promise<never>>().mockRejectedValue(new Error('x')),
    })
    const wrapper = mount(RunSummaryView, { global: { stubs: { RouteMap } } })
    await flushPromises()
    expect(wrapper.text()).toContain('Could not load the run')
    expect(button(wrapper, 'Retry')).toBeDefined()
  })

  it('exports the run as GPX, and says so when that fails', async () => {
    const { wrapper } = await open()
    await button(wrapper, 'Export GPX')!.trigger('click')
    await flushPromises()
    expect(share.shareGpx).toHaveBeenCalledOnce()
    const [fileName, xml] = share.shareGpx.mock.calls[0]!
    expect(fileName).toMatch(/^run-\d{4}-\d{2}-\d{2}-\d{4}\.gpx$/)
    expect(xml).toContain('<trkpt lat="52.0000000" lon="4.0000000">')
    expect(wrapper.text()).not.toContain('Could not export')

    share.shareGpx.mockRejectedValueOnce(new Error('disk full'))
    await button(wrapper, 'Export GPX')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Could not export the run')
  })

  it('asks before deleting, then deletes the run and goes to History', async () => {
    const { wrapper, repo } = await open()
    await button(wrapper, 'Delete')!.trigger('click')
    expect(wrapper.text()).toContain('Delete this run?')

    await dialogButton(wrapper, 'Keep')!.trigger('click')
    expect(wrapper.text()).not.toContain('Delete this run?')
    expect(await repo.getRun('r1')).not.toBeNull()

    await button(wrapper, 'Delete')!.trigger('click')
    await dialogButton(wrapper, 'Delete')!.trigger('click')
    await flushPromises()
    expect(await repo.getRun('r1')).toBeNull()
    expect(await repo.loadPoints('r1')).toEqual([])
    expect(nav.replace).toHaveBeenCalledWith({ name: 'history' })
  })

  it('keeps the dialog open and says so when deleting fails', async () => {
    const { wrapper, repo } = await open()
    useRunStore().useRepository({
      ...repo,
      deleteRun: vi.fn<() => Promise<never>>().mockRejectedValue(new Error('x')),
    })
    await button(wrapper, 'Delete')!.trigger('click')
    await dialogButton(wrapper, 'Delete')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Could not delete the run')
    expect(nav.replace).not.toHaveBeenCalled()
  })

  describe('session link (#102)', () => {
    const planStep = (sessionId: string): SessionStep => ({
      id: 'st1',
      sessionId,
      position: 0,
      kind: 'run',
      targetKind: 'duration',
      targetValue: 5,
      paceMin: null,
      paceMax: null,
      repetitions: null,
      span: null,
    })

    /** A program with one session of 5 s (the seeded run took 3 s), and one rest day */
    async function plan() {
      const training = useTrainingStore()
      const programId = await training.createProgram({
        name: 'Beginner',
        goal: null,
        weeks: 2,
        startDate: null,
      })
      const easy = await training.saveSession(programId, {
        week: 1,
        type: 'easy',
        title: 'Easy 5 s',
        notes: null,
      })
      await training.saveSession(programId, { week: 1, type: 'rest', title: 'Rest', notes: null })
      await training.replaceSteps(easy, [planStep(easy)])
      return { easy }
    }

    it('offers no link when there is no training program', async () => {
      const { wrapper } = await open()
      expect(wrapper.find('.session').exists()).toBe(false)
    })

    it('links a free run to a session and shows planned vs. done', async () => {
      const { easy } = await plan()
      const { wrapper, repo } = await open()
      await button(wrapper, 'Link to a session')!.trigger('click')
      await flushPromises()
      const choices = wrapper.findAll('.choice')
      // The rest day is not offered
      expect(choices).toHaveLength(1)
      await choices[0]!.trigger('click')
      await flushPromises()

      expect((await repo.getRun('r1'))?.sessionId).toBe(easy)
      expect(wrapper.find('.dialog').exists()).toBe(false)
      expect(wrapper.find('.session__name').text()).toContain('Easy 5 s')
      expect(wrapper.find('.plan__row').text()).toContain('00:03')
      expect(wrapper.find('.plan__row').text()).toContain('planned 00:05')
    })

    it('names a session without a title from its steps, in the picker and once linked (#143)', async () => {
      const { easy } = await plan()
      const training = useTrainingStore()
      const session = (await training.getSession(easy))!
      await training.saveSession(session.programId, { ...session, title: '' }, easy)
      const { wrapper } = await open()
      await button(wrapper, 'Link to a session')!.trigger('click')
      await flushPromises()
      expect(wrapper.find('.choice__title').text()).toBe('Run 0:05')
      await wrapper.find('.choice').trigger('click')
      await flushPromises()
      expect(wrapper.find('.session__name').text()).toContain('Run 0:05')
    })

    it('unlinks a run from its session', async () => {
      const { easy } = await plan()
      const { wrapper, repo } = await open()
      await repo.setRunSession('r1', easy)
      await wrapper.unmount()
      const again = mount(RunSummaryView, { global: { stubs: { RouteMap } } })
      await flushPromises()
      expect(again.find('.session__name').text()).toContain('Easy 5 s')

      await button(again, 'Unlink from session')!.trigger('click')
      await flushPromises()
      expect((await repo.getRun('r1'))?.sessionId).toBeNull()
      expect(button(again, 'Link to a session')).toBeDefined()
    })

    it('says so when the session has no planned total', async () => {
      const { easy } = await plan()
      await useTrainingStore().replaceSteps(easy, [])
      const { wrapper, repo } = await open()
      await repo.setRunSession('r1', easy)
      await wrapper.unmount()
      const again = mount(RunSummaryView, { global: { stubs: { RouteMap } } })
      await flushPromises()
      expect(again.text()).toContain('no planned total')
    })
  })
})
