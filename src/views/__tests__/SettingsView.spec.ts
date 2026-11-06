import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryRunRepository } from '@/lib/db/memoryRunRepository'
import type { RunRecord } from '@/lib/db/runRepository'
import { buildBackup } from '@/lib/backup'
import { useRunStore } from '@/stores/run'
import { useTrainingStore } from '@/stores/training'
import type { TrackingStatus } from '@/lib/trackingStatus'
import SettingsView from '../SettingsView.vue'

const mocks = vi.hoisted(() => ({
  status: null as TrackingStatus | null,
  resume: null as (() => void) | null,
  getTrackingStatus: vi.fn<() => Promise<TrackingStatus | null>>(),
  openAppSettings: vi.fn<() => Promise<void>>(async () => {}),
  requestLocationPermission: vi.fn<() => Promise<string>>(async () => 'granted'),
  ensureNotifications: vi.fn<() => Promise<boolean>>(async () => true),
  askBatteryExemption: vi.fn<() => Promise<boolean>>(async () => true),
  openBatterySettings: vi.fn<() => Promise<void>>(async () => {}),
  speak: vi.fn<(text: string) => Promise<void>>(async () => {}),
}))
const shared = { name: '', text: '', mime: '' }
const shareFile = vi.hoisted(() =>
  vi.fn<
    (
      name: string,
      content: string | AsyncIterable<string>,
      mime: string,
    ) => Promise<string | null>
  >(async (name, content, mime) => {
    let text = ''
    if (typeof content === 'string') text = content
    else for await (const piece of content) text += piece
    shared.name = name
    shared.text = text
    shared.mime = mime
    return null
  }),
)

vi.mock('@/lib/speech', () => ({ speak: mocks.speak }))
vi.mock('@/lib/shareRun', () => ({ shareFile, reshareFile: async () => false }))
vi.mock('@/lib/trackingStatus', () => ({ getTrackingStatus: mocks.getTrackingStatus }))
vi.mock('@/lib/gps', () => ({
  openAppSettings: mocks.openAppSettings,
  requestLocationPermission: mocks.requestLocationPermission,
}))
vi.mock('@/lib/runPower', () => ({
  ensureNotifications: mocks.ensureNotifications,
  askBatteryExemption: mocks.askBatteryExemption,
  openBatterySettings: mocks.openBatterySettings,
}))
vi.mock('@/composables/useAppResume', () => ({
  useAppResume: (cb: () => void) => {
    mocks.resume = cb
  },
}))

const allGood: TrackingStatus = { location: 'granted', notifications: 'granted', battery: 'exempt' }

// The audio cue and backup sections have their own buttons; these tests are about the permission rows
const permissionButtons = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('.row:not(.cues):not(.backup) button')

const button = (wrapper: ReturnType<typeof mount>, label: string) =>
  wrapper.findAll('button').find((b) => b.text() === label)

async function open(status: TrackingStatus | null) {
  mocks.getTrackingStatus.mockResolvedValue(status)
  const wrapper = mount(SettingsView)
  await flushPromises()
  return wrapper
}

describe('SettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    useRunStore().useRepository(createMemoryRunRepository())
  })

  it('says ready when everything is allowed, and still shows the Samsung hint and units', async () => {
    const wrapper = await open(allGood)
    expect(wrapper.text()).toContain('Ready to track')
    expect(wrapper.text()).toContain('Allowed')
    expect(wrapper.text()).toContain('Only this time') // the tip: the state itself can't tell
    expect(wrapper.text()).not.toContain('all the time')
    expect(button(wrapper, 'Allow')).toBeUndefined() // nothing to fix, only the revoke links
    expect(wrapper.text()).toContain('Never sleeping apps')
    expect(wrapper.text()).toContain('Metric (km, min/km)')
  })

  it('offers Allow for a permission that can still be asked, and Open settings once refused', async () => {
    const wrapper = await open({ ...allGood, location: 'prompt', notifications: 'denied' })
    expect(wrapper.text()).toContain('2 things need attention')

    await button(wrapper, 'Allow')!.trigger('click')
    expect(mocks.requestLocationPermission).toHaveBeenCalledOnce()

    await button(wrapper, 'Open settings')!.trigger('click')
    expect(mocks.openAppSettings).toHaveBeenCalledOnce()
    expect(mocks.ensureNotifications).not.toHaveBeenCalled()
  })

  it('asks for the notification permission from the Notifications row', async () => {
    const wrapper = await open({ ...allGood, notifications: 'prompt' })
    await button(wrapper, 'Allow')!.trigger('click')
    expect(mocks.ensureNotifications).toHaveBeenCalledOnce()
  })

  it('opens the battery dialog and refreshes the rows afterwards', async () => {
    const wrapper = await open({ ...allGood, battery: 'not-exempt' })
    expect(wrapper.text()).toContain('1 thing needs attention')
    expect(wrapper.text()).toContain('Never sleeping apps')

    mocks.getTrackingStatus.mockResolvedValue(allGood)
    await button(wrapper, 'Allow')!.trigger('click')
    await flushPromises()
    expect(mocks.askBatteryExemption).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Ready to track')
  })

  it('refreshes when the app comes back from Android settings', async () => {
    const wrapper = await open({ ...allGood, location: 'denied' })
    expect(button(wrapper, 'Open settings')).toBeDefined()

    mocks.getTrackingStatus.mockResolvedValue(allGood)
    mocks.resume!()
    await flushPromises()
    expect(button(wrapper, 'Open settings')).toBeUndefined()
    expect(wrapper.text()).toContain('Ready to track')
  })

  it('shows Could not check on the row that failed, without a button', async () => {
    const wrapper = await open({ ...allGood, notifications: 'unknown' })
    expect(wrapper.text()).toContain('Could not check')
    expect(wrapper.text()).toContain('Some settings could not be checked')
    // only the other rows (location, battery) have their settings link
    expect(permissionButtons(wrapper).map((b) => b.text())).toEqual([
      'Revoke in settings',
      'Change in settings',
    ])
  })

  it('lets you open the system pages to revoke or change what is granted', async () => {
    const wrapper = await open(allGood)
    expect(permissionButtons(wrapper).map((b) => b.text())).toEqual([
      'Revoke in settings',
      'Revoke in settings',
      'Change in settings',
    ])

    await permissionButtons(wrapper)[0]!.trigger('click')
    await permissionButtons(wrapper)[1]!.trigger('click')
    expect(mocks.openAppSettings).toHaveBeenCalledTimes(2)

    await button(wrapper, 'Change in settings')!.trigger('click')
    expect(mocks.openBatterySettings).toHaveBeenCalledOnce()
  })

  it('has no buttons in the browser', async () => {
    const wrapper = await open(null)
    expect(wrapper.text()).toContain('Only available on the phone')
    expect(permissionButtons(wrapper)).toHaveLength(0)
    expect(wrapper.text()).toContain('Metric (km, min/km)')
  })

  it('changes the cue interval and speaks a sample on Test cue', async () => {
    const wrapper = await open(null)
    const group = wrapper.get('[aria-label="Cue every distance"]')
    const five = group.findAll('button').find((b) => b.text() === '5 km')!
    await five.trigger('click')
    expect(five.attributes('aria-pressed')).toBe('true')
    await button(wrapper, 'Test cue')!.trigger('click')
    expect(mocks.speak).toHaveBeenCalledWith(expect.stringContaining('1 kilometre'))
  })

  describe('backup', () => {
    const finished = (id: string, name: string | null = null): RunRecord => ({
      id,
      name,
      status: 'finished',
      startedAt: 1_000,
      finishedAt: 61_000,
      elapsedMs: 60_000,
      segment: 0,
      segmentStartedAt: null,
      movingMs: 60_000,
      distanceM: 100,
    })
    const backupFile = (text: string) => ({ text: async () => text }) as unknown as File
    const pick = async (wrapper: ReturnType<typeof mount>, text: string) => {
      const input = wrapper.get('input[type="file"]')
      Object.defineProperty(input.element, 'files', { value: [backupFile(text)], configurable: true })
      await input.trigger('change')
      await flushPromises()
    }

    it('disables Back up and says why when there are no runs and no programs', async () => {
      const wrapper = await open(allGood)
      expect(button(wrapper, 'Back up')!.attributes('disabled')).toBeDefined()
      expect(wrapper.text()).toContain('Nothing to back up yet.')
    })

    it('backs up training programs when there are no runs', async () => {
      await useTrainingStore().createProgram({ name: 'Half', goal: null, weeks: 4, startDate: null })
      const wrapper = await open(allGood)
      expect(wrapper.text()).not.toContain('Nothing to back up yet.')
      await button(wrapper, 'Back up')!.trigger('click')
      await flushPromises()
      expect(JSON.parse(shared.text).programs).toHaveLength(1)
      expect(wrapper.text()).toContain('Backed up 1 program')
    })

    it('shares one backup file with every finished run and its points', async () => {
      const run = useRunStore()
      await run.importRun(finished('a', 'Haren'), [{ segment: 0, timestamp: 5, lat: 1, lon: 2 }])
      await run.importRun(finished('b'), [])
      const wrapper = await open(allGood)
      await button(wrapper, 'Back up')!.trigger('click')
      await flushPromises()
      expect(shareFile).toHaveBeenCalledOnce()
      const { name, text, mime } = shared
      expect(name).toMatch(/^run-tracker-backup-\d{4}-\d{2}-\d{2}\.json$/)
      expect(mime).toBe('application/json')
      expect(JSON.parse(text).runs.map((r: { run: RunRecord }) => r.run.id).sort()).toEqual(['a', 'b'])
      expect(wrapper.text()).toContain('Backed up 2 runs')
    })

    it('restores the missing runs and counts the ones already on the phone', async () => {
      const run = useRunStore()
      await run.importRun(finished('a'), [])
      const wrapper = await open(allGood)
      const text = buildBackup(
        [
          { run: finished('a'), points: [] },
          { run: finished('b', 'Haren'), points: [{ segment: 0, timestamp: 5, lat: 1, lon: 2 }] },
        ],
        [],
        0,
      )
      await pick(wrapper, text)
      expect(wrapper.text()).toContain('Restored 1 run, 1 already on this phone')
      expect((await run.listFinished()).map((r) => r.id).sort()).toEqual(['a', 'b'])
      expect(await run.loadPoints('b')).toHaveLength(1)
      // The new run now allows a backup
      expect(button(wrapper, 'Back up')!.attributes('disabled')).toBeUndefined()
    })

    it('shows the reason and changes nothing for a file that is not a backup', async () => {
      const wrapper = await open(allGood)
      await pick(wrapper, '{"hello":1}')
      expect(wrapper.text()).toContain('not a Run Tracker backup')
      expect(await useRunStore().listFinished()).toEqual([])
    })

    it('keeps a backup going when the screen is closed, and refuses a second one on reopen', async () => {
      const run = useRunStore()
      await run.importRun(finished('a'), [])
      let finish!: () => void
      shareFile.mockImplementationOnce(async (_name, content) => {
        if (typeof content !== 'string') for await (const piece of content) void piece
        await new Promise<void>((resolve) => (finish = resolve))
        return null
      })
      const first = await open(allGood)
      await button(first, 'Back up')!.trigger('click')
      await flushPromises()
      expect(first.text()).toContain('Backing up 1 of 1 runs')
      first.unmount() // the user switched tab

      const second = await open(allGood)
      expect(second.text()).toContain('Backing up 1 of 1 runs') // still shown
      expect(button(second, 'Back up')!.attributes('disabled')).toBeDefined()
      await button(second, 'Back up')!.trigger('click')
      expect(shareFile).toHaveBeenCalledOnce() // no second share

      finish()
      await flushPromises()
      expect(second.text()).toContain('Backed up 1 run')
      expect(button(second, 'Back up')!.attributes('disabled')).toBeUndefined()
    })

    it('blocks backup and restore while a run is running or paused', async () => {
      const run = useRunStore()
      await run.importRun(finished('a'), [])
      run.start(1_000)
      const wrapper = await open(allGood)
      expect(button(wrapper, 'Back up')!.attributes('disabled')).toBeDefined()
      expect(wrapper.get('input[type="file"]').attributes('disabled')).toBeDefined()
      expect(wrapper.text()).toContain('Finish or stop your run first.')
      await pick(wrapper, buildBackup([{ run: finished('z'), points: [] }], [], 0))
      expect((await run.listFinished()).map((r) => r.id)).toEqual(['a'])
    })
  })
})
