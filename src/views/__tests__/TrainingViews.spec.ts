import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { routes } from '@/router'
import { useTrainingStore } from '@/stores/training'
import { useRunStore } from '@/stores/run'
import { followedProgramId, setFollowedProgram } from '@/lib/settings'
import { unavailableTrainingRepository } from '@/lib/db/trainingRepository'
import { createMemoryTrainingRepository } from '@/lib/db/memoryTrainingRepository'
import type { SessionStep, StepBlock } from '@/lib/training'

// The real routes on an in-memory history: these tests walk the screens the way a tap would
async function open(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  const wrapper = mount(RouterView, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, router }
}

type Wrapper = Awaited<ReturnType<typeof open>>['wrapper']
const button = (wrapper: Wrapper, label: string) => {
  const found = wrapper.findAll('button').find((b) => b.text() === label)
  if (!found) throw new Error(`No button "${label}" in: ${wrapper.text()}`)
  return found
}
const link = (wrapper: Wrapper, text: string) => {
  const found = wrapper.findAll('a').find((a) => a.text().includes(text))
  if (!found) throw new Error(`No link "${text}" in: ${wrapper.text()}`)
  return found
}
const click = async (el: { trigger(event: string): Promise<void> }) => {
  await el.trigger('click')
  await flushPromises()
}

const half = { name: 'Half marathon', goal: 'Sub 2:00', weeks: 3, startDate: null }

describe('training screens', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('shows an empty list that leads to a new program', async () => {
    const { wrapper } = await open('/training')
    expect(wrapper.text()).toContain('No training programs yet')
    expect(link(wrapper, '+ New program').attributes('href')).toBe('/training/new')
  })

  it('lists programs with their goal, weeks and sessions', async () => {
    const training = useTrainingStore()
    const id = await training.createProgram(half)
    await training.saveSession(id, { week: 1, type: 'easy', title: 'Easy', notes: null })
    const { wrapper } = await open('/training')
    expect(wrapper.find('.row').text()).toContain('Half marathon')
    expect(wrapper.find('.row').text()).toContain('Sub 2:00 · 3 weeks · 1 session')
  })

  it('says so when the programs cannot be loaded', async () => {
    useTrainingStore().useRepository(unavailableTrainingRepository(new Error('no db')))
    const { wrapper } = await open('/training')
    expect(wrapper.text()).toContain('Could not load programs')
    expect(button(wrapper, 'Retry').exists()).toBe(true)
  })

  it('creates a program and opens it, with every week shown', async () => {
    const { wrapper, router } = await open('/training/new')
    await wrapper.get('#program-name').setValue('Half marathon')
    await wrapper.get('#program-goal').setValue('Sub 2:00')
    await click(button(wrapper, '+'))
    expect(wrapper.get('.stepper__value').text()).toBe('9')
    await click(button(wrapper, 'Save'))
    expect(router.currentRoute.value.name).toBe('program')
    expect(wrapper.text()).toContain('Sub 2:00 · 9 weeks')
    expect(wrapper.findAll('.week')).toHaveLength(9)
    expect(wrapper.findAll('.empty-week')).toHaveLength(9)
  })

  it('shows the rule that was broken instead of saving', async () => {
    const { wrapper, router } = await open('/training/new')
    await click(button(wrapper, 'Save'))
    expect(wrapper.get('[role="alert"]').text()).toBe('Give the program a name.')
    expect(router.currentRoute.value.name).toBe('program-new')
    expect(await useTrainingStore().listPrograms()).toEqual([])
  })

  it('adds a session to a week and lists it there, in order', async () => {
    const training = useTrainingStore()
    const id = await training.createProgram(half)
    const { wrapper, router } = await open(`/training/${id}`)
    await click(link(wrapper, '+ Add session to week 2'))
    expect(router.currentRoute.value.query.week).toBe('2')
    expect(wrapper.get('.stepper__value').text()).toBe('2')
    await click(button(wrapper, 'Intervals'))
    await wrapper.get('#session-title').setValue('6×400 m')
    await click(button(wrapper, 'Save'))
    expect(router.currentRoute.value.name).toBe('program')
    const week2 = wrapper.findAll('.week')[1]!
    expect(week2.text()).toContain('Intervals')
    expect(week2.text()).toContain('6×400 m')
  })

  it('edits a session from its view', async () => {
    const training = useTrainingStore()
    const id = await training.createProgram(half)
    const sid = await training.saveSession(id, {
      week: 1,
      type: 'easy',
      title: 'Easy',
      notes: null,
    })
    const { wrapper, router } = await open(`/training/${id}`)
    // A session opens in its view; editing is behind Edit (#147)
    await click(link(wrapper, 'Easy'))
    expect(router.currentRoute.value.name).toBe('session')
    expect(wrapper.find('input, textarea').exists()).toBe(false)
    await click(link(wrapper, 'Edit'))
    expect(router.currentRoute.value.name).toBe('session-edit')
    expect((wrapper.get('#session-title').element as HTMLInputElement).value).toBe('Easy')
    await wrapper.get('#session-notes').setValue('Flat route')
    await click(button(wrapper, 'Save'))
    expect((await training.getSession(sid))!.notes).toBe('Flat route')
    // Save goes back to the view, which shows the change
    expect(router.currentRoute.value.name).toBe('session')
    expect(wrapper.get('.notes').text()).toBe('Flat route')
    // Removing lives in the editor, not on the view (#150)
    const labels = wrapper.findAll('button').map((b) => b.text())
    expect(labels).not.toContain('Remove from program')
    expect(labels).not.toContain('Delete session')
  })

  it('removes a session from its editor after asking, leaving past its view (#150)', async () => {
    const training = useTrainingStore()
    const id = await training.createProgram(half)
    const sid = await training.saveSession(id, {
      week: 1,
      type: 'easy',
      title: 'Easy',
      notes: null,
    })
    const { wrapper, router } = await open(`/training/${id}`)
    await click(link(wrapper, 'Easy'))
    await click(link(wrapper, 'Edit'))
    await click(button(wrapper, 'Remove from program'))
    const dialog = wrapper.get('[role="alertdialog"]')
    expect(dialog.text()).toContain('Remove Easy from week 1?')
    expect(dialog.text()).toContain('It comes off the program.')
    await click(button(wrapper, 'Remove'))
    expect(await training.getSession(sid)).toBeNull()
    expect(router.currentRoute.value.name).toBe('program')
    expect(wrapper.findAll('.empty-week')).toHaveLength(3)
    // Back does not land on the view of the removed session
    router.back()
    await flushPromises()
    expect(router.currentRoute.value.name).not.toBe('session')
  })

  it('removes a session from an editor opened directly and lands on the program (#150)', async () => {
    const training = useTrainingStore()
    const id = await training.createProgram(half)
    const sid = await training.saveSession(id, {
      week: 1,
      type: 'easy',
      title: 'Easy',
      notes: null,
    })
    const { wrapper, router } = await open(`/training/${id}/session/${sid}/edit`)
    await click(button(wrapper, 'Remove from program'))
    await click(button(wrapper, 'Remove'))
    expect(await training.getSession(sid)).toBeNull()
    expect(router.currentRoute.value.name).toBe('program')
  })

  it('shows a session at a glance: title, done, run, notes, steps and runs, in that order (#147)', async () => {
    const training = useTrainingStore()
    const run = useRunStore()
    const id = await training.createProgram(half)
    const sid = await training.saveSession(id, {
      week: 2,
      type: 'intervals',
      title: '6×400 m',
      notes: 'Track',
    })
    run.start(0, sid)
    await run.finish(1_000)
    const { wrapper } = await open(`/training/${id}/session/${sid}`)
    const text = wrapper.text()
    const order = [
      '6×400 m',
      'Intervals · Week 2',
      '✓ Done',
      'Run again',
      'Notes',
      'Track',
      'Steps',
      'No steps yet.',
      'Runs',
    ]
    const at = order.map((t) => text.indexOf(t))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(wrapper.find('input, textarea, select').exists()).toBe(false)
  })

  it('leaves out empty notes, and a cancelled edit opened directly returns to the view (#147)', async () => {
    const training = useTrainingStore()
    const id = await training.createProgram(half)
    const sid = await training.saveSession(id, {
      week: 1,
      type: 'easy',
      title: 'Easy',
      notes: null,
    })
    const view = await open(`/training/${id}/session/${sid}`)
    expect(view.wrapper.text()).not.toContain('Notes')

    const { wrapper, router } = await open(`/training/${id}/session/${sid}/edit`)
    await click(button(wrapper, '‹ Cancel'))
    expect(router.currentRoute.value.name).toBe('session')
    expect(wrapper.get('h1').text()).toBe('Easy')
  })

  it('opens a new session in the editor, which offers no run, skip or remove (#147, #150)', async () => {
    const training = useTrainingStore()
    const id = await training.createProgram(half)
    const sid = await training.saveSession(id, {
      week: 1,
      type: 'easy',
      title: 'Easy',
      notes: null,
    })
    const fresh = await open(`/training/${id}/session/new`)
    expect(fresh.router.currentRoute.value.name).toBe('session-new')
    expect(fresh.wrapper.find('#session-title').exists()).toBe(true)
    expect(fresh.wrapper.findAll('button').map((b) => b.text())).not.toContain(
      'Remove from program',
    )

    const { wrapper } = await open(`/training/${id}/session/${sid}/edit`)
    const labels = wrapper.findAll('button').map((b) => b.text())
    for (const label of ['Run this session', 'Skip']) {
      expect(labels).not.toContain(label)
    }
    expect(labels).toContain('Remove from program')
  })

  it('deletes a program after a confirmation naming its sessions and saying runs are kept', async () => {
    const training = useTrainingStore()
    const id = await training.createProgram(half)
    await training.saveSession(id, { week: 1, type: 'easy', title: 'Easy', notes: null })
    await training.saveSession(id, { week: 2, type: 'long', title: '12 km', notes: null })
    const { wrapper, router } = await open(`/training/${id}/edit`)
    await click(button(wrapper, 'Delete program'))
    const dialog = wrapper.get('[role="alertdialog"]')
    expect(dialog.text()).toContain('Delete Half marathon?')
    expect(dialog.text()).toContain('Its 2 sessions go too. Your runs are kept.')
    await click(button(wrapper, 'Keep'))
    expect(await training.getProgram(id)).not.toBeNull()

    await click(button(wrapper, 'Delete program'))
    await click(button(wrapper, 'Delete'))
    expect(await training.getProgram(id)).toBeNull()
    expect(router.currentRoute.value.name).toBe('training')
  })

  it('refuses to drop weeks that still have sessions, saying which', async () => {
    const training = useTrainingStore()
    const id = await training.createProgram(half)
    await training.saveSession(id, { week: 3, type: 'easy', title: 'Easy', notes: null })
    const { wrapper } = await open(`/training/${id}/edit`)
    await click(button(wrapper, '−'))
    await click(button(wrapper, 'Save'))
    expect(wrapper.get('[role="alert"]').text()).toContain('Week 3 and later still have 1 session')
    expect((await training.getProgram(id))!.weeks).toBe(3)
  })

  it('says a program is gone when it was deleted', async () => {
    const { wrapper } = await open('/training/missing')
    expect(wrapper.text()).toContain('This program no longer exists')
  })
})

describe('running sessions (#40)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    setFollowedProgram(null)
  })

  /** A program with an easy run (done when `doneFirst`), a rest day and a long run */
  async function program({ doneFirst = false } = {}) {
    const training = useTrainingStore()
    const id = await training.createProgram(half)
    const easy = await training.saveSession(id, {
      week: 1,
      type: 'easy',
      title: 'Easy',
      notes: null,
    })
    const rest = await training.saveSession(id, {
      week: 1,
      type: 'rest',
      title: 'Rest',
      notes: null,
    })
    const long = await training.saveSession(id, {
      week: 2,
      type: 'long',
      title: '12 km',
      notes: null,
    })
    if (doneFirst) {
      const run = useRunStore()
      run.start(0, easy)
      await run.finish(1_000)
    }
    return { id, easy, rest, long }
  }

  it('follows a program and stops following it', async () => {
    const { id } = await program()
    const { wrapper } = await open(`/training/${id}`)
    await click(button(wrapper, 'Follow this program'))
    expect(followedProgramId.value).toBe(id)
    await click(button(wrapper, '✓ Following'))
    expect(followedProgramId.value).toBeNull()
  })

  it('ticks done sessions and marks the next one, past rest days', async () => {
    const { id } = await program({ doneFirst: true })
    const { wrapper } = await open(`/training/${id}`)
    const rows = wrapper.findAll('.row')
    expect(rows[0]!.classes()).toContain('row--done')
    expect(rows[0]!.text()).toContain('✓')
    expect(rows[1]!.text()).not.toContain('Next')
    expect(rows[2]!.text()).toContain('Next')
  })

  it('opens the Run screen with the session ready, from the session view', async () => {
    const { id, long } = await program()
    const { wrapper, router } = await open(`/training/${id}/session/${long}`)
    await click(button(wrapper, 'Run this session'))
    expect(router.currentRoute.value.name).toBe('run')
    expect(router.currentRoute.value.query).toEqual({ session: long })
  })

  it('skips a session from its view, and undoes it (#102)', async () => {
    const { id, easy } = await program()
    const { wrapper } = await open(`/training/${id}/session/${easy}`)
    await click(button(wrapper, 'Skip'))
    expect(wrapper.text()).toContain('Skipped')
    expect(await useTrainingStore().skippedSessionIds()).toEqual([easy])

    const program1 = await open(`/training/${id}`)
    const rows = program1.wrapper.findAll('.row')
    expect(rows[0]!.text()).toContain('Skipped')
    expect(rows[0]!.text()).not.toContain('Next')
    // The next session moves on to the long run
    expect(rows[2]!.text()).toContain('Next')

    const again = await open(`/training/${id}/session/${easy}`)
    await click(button(again.wrapper, 'Undo skip'))
    expect(button(again.wrapper, 'Skip')).toBeDefined()
    expect(await useTrainingStore().skippedSessionIds()).toEqual([])
  })

  it('keeps Undo skip for a skipped session that was run, so the skip cannot return unseen (#102)', async () => {
    const { id, easy } = await program()
    await useTrainingStore().setSkipped(easy, true)
    const run = useRunStore()
    run.start(0, easy)
    await run.finish(1_000)
    const { wrapper } = await open(`/training/${id}/session/${easy}`)
    expect(wrapper.text()).toContain('✓ Done')
    expect(wrapper.text()).not.toContain('passes over it')
    await click(button(wrapper, 'Undo skip'))
    expect(await useTrainingStore().skippedSessionIds()).toEqual([])
  })

  it('offers no skip for a rest day or a session that was run (#102)', async () => {
    const { id, easy, rest } = await program({ doneFirst: true })
    const labels = async (sid: string) =>
      (await open(`/training/${id}/session/${sid}`)).wrapper.findAll('button').map((b) => b.text())
    expect(await labels(easy)).not.toContain('Skip')
    expect(await labels(rest)).not.toContain('Skip')
  })

  it('shows each week against its plan: sessions, skips, time and distance (#102)', async () => {
    const { id, easy, long } = await program({ doneFirst: true })
    const training = useTrainingStore()
    const target = (sessionId: string, seconds: number): SessionStep => ({
      id: `step-${sessionId}`,
      sessionId,
      position: 0,
      kind: 'run',
      targetKind: 'duration',
      targetValue: seconds,
      paceMin: null,
      paceMax: null,
      repetitions: null,
      span: null,
    })
    await training.replaceSteps(easy, [target(easy, 1800)])
    await training.replaceSteps(long, [target(long, 3600)])
    await training.setSkipped(long, true)
    const { wrapper } = await open(`/training/${id}`)
    const lines = wrapper.findAll('.week__summary').map((p) => p.text())
    // Week 1: the easy run took 1 s of its 30 min; week 2: the only session is skipped
    expect(lines[0]).toBe('1 of 1 session · 0 of 30 min')
    expect(lines[1]).toBe('0 of 1 session · 1 skipped')
  })

  it('lists the runs of a session, each opening its summary (#102)', async () => {
    const { id, easy } = await program({ doneFirst: true })
    const run = useRunStore()
    run.start(5_000, easy)
    await run.finish(9_000)
    const { wrapper } = await open(`/training/${id}/session/${easy}`)
    const rows = wrapper.findAll('.runs .row')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.attributes('href')).toMatch(/^\/run\//)
  })

  it('lists no runs for a session that was not run', async () => {
    const { id, long } = await program()
    const { wrapper } = await open(`/training/${id}/session/${long}`)
    expect(wrapper.find('.runs').exists()).toBe(false)
  })

  it('offers "Run again" on a done session and opens the Run screen with it (#116)', async () => {
    const { id, easy } = await program({ doneFirst: true })
    const { wrapper, router } = await open(`/training/${id}/session/${easy}`)
    expect(wrapper.text()).toContain('✓ Done')
    expect(wrapper.findAll('button').map((b) => b.text())).not.toContain('Run this session')
    await click(button(wrapper, 'Run again'))
    expect(router.currentRoute.value.name).toBe('run')
    expect(router.currentRoute.value.query).toEqual({ session: easy })
  })

  it('offers no run for a rest day', async () => {
    const { id, rest } = await program({ doneFirst: true })
    const restDay = await open(`/training/${id}/session/${rest}`)
    const labels = restDay.wrapper.findAll('button').map((b) => b.text())
    expect(labels).not.toContain('Run this session')
    expect(labels).not.toContain('Run again')
  })

  it('names the runs done for a program before deleting it, and keeps them', async () => {
    const { id } = await program({ doneFirst: true })
    const { wrapper } = await open(`/training/${id}/edit`)
    await click(button(wrapper, 'Delete program'))
    expect(wrapper.get('[role="alertdialog"]').text()).toContain(
      'Its 3 sessions go too. The run you did for it is kept.',
    )
    await click(button(wrapper, 'Delete'))
    const runs = await useRunStore().listFinished()
    expect(runs).toHaveLength(1)
    expect(followedProgramId.value).toBeNull()
  })

  it('says the run is kept when removing a done session (#150)', async () => {
    const { id, easy } = await program({ doneFirst: true })
    const { wrapper } = await open(`/training/${id}/session/${easy}/edit`)
    await click(button(wrapper, 'Remove from program'))
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('Your run for it is kept.')
  })
})

describe('session steps', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  const plain = (id: string, over: Partial<SessionStep> = {}): SessionStep => ({
    id,
    sessionId: '',
    position: 0,
    kind: 'run',
    targetKind: 'duration',
    targetValue: 60,
    paceMin: null,
    paceMax: null,
    repetitions: null,
    span: null,
    ...over,
  })

  // A run/walk session: warm-up walk, 6× (run 1:00, walk 2:00)
  async function runWalk() {
    const training = useTrainingStore()
    const id = await training.createProgram(half)
    const sid = await training.saveSession(id, {
      week: 1,
      type: 'runwalk',
      title: 'Run/walk',
      notes: null,
    })
    await training.saveBlocks(sid, [
      { step: plain('warm', { kind: 'warmup', targetValue: 300 }), children: [] },
      {
        step: plain('rep', {
          kind: 'repeat',
          targetKind: 'none',
          targetValue: null,
          repetitions: 6,
        }),
        children: [plain('run'), plain('walk', { kind: 'walk', targetValue: 120 })],
      },
    ])
    const base = `/training/${id}/session/${sid}`
    return { training, id, sid, base, edit: `${base}/edit` }
  }
  const stepTexts = (wrapper: Wrapper) => wrapper.findAll('.step__text').map((s) => s.text())

  it('lists the steps, with a repeat as a box holding its own', async () => {
    const { edit } = await runWalk()
    const { wrapper } = await open(edit)
    expect(stepTexts(wrapper)).toEqual(['Warm-up 5:00', '6× · 2 steps', 'Run 1:00', 'Walk 2:00'])
    const repeat = wrapper.get('.step--repeat')
    expect(repeat.findAll('.step-list--inner .step__text').map((s) => s.text())).toEqual([
      'Run 1:00',
      'Walk 2:00',
    ])
    expect(wrapper.text()).toContain('Steps are saved as you change them.')
    expect(button(wrapper, 'Run/walk').attributes('aria-pressed')).toBe('true')
  })

  it('shows the steps read-only in the session view (#147)', async () => {
    const { base } = await runWalk()
    const { wrapper } = await open(base)
    expect(stepTexts(wrapper)).toEqual(['Warm-up 5:00', '6× · 2 steps', 'Run 1:00', 'Walk 2:00'])
    expect(wrapper.get('.step--repeat').findAll('.step-list--inner .step__text')).toHaveLength(2)
    expect(wrapper.find('.step__handle').exists()).toBe(false)
    expect(wrapper.findAll('button').some((b) => b.text() === '+ Add step')).toBe(false)
  })

  it('saves a new session on "+ Add step" and opens a new step; Cancel lands on Edit session (#143)', async () => {
    const training = useTrainingStore()
    const id = await training.createProgram(half)
    const { wrapper, router } = await open(`/training/${id}/session/new`)
    expect(wrapper.text()).toContain('No steps yet.')
    await click(button(wrapper, 'Run/walk'))
    await click(button(wrapper, '+ Add step'))
    expect(router.currentRoute.value.name).toBe('step-new')
    const [session] = await training.listSessions(id)
    expect(session).toMatchObject({ type: 'runwalk', title: '' })
    expect(router.currentRoute.value.params.sid).toBe(session!.id)
    await click(button(wrapper, '‹ Cancel'))
    expect(router.currentRoute.value.name).toBe('session-edit')
    expect(wrapper.find('h1').text()).toBe('Edit session')
  })

  it('shows the rule instead of opening a step when the new session cannot be saved', async () => {
    const training = useTrainingStore()
    const id = await training.createProgram(half)
    const { wrapper, router } = await open(`/training/${id}/session/new`)
    await training.deleteProgram(id)
    await click(button(wrapper, '+ Add step'))
    expect(wrapper.get('[role="alert"]').text()).toBe('This program no longer exists.')
    expect(router.currentRoute.value.name).toBe('session-new')
  })

  it('hides the steps of a new rest day', async () => {
    const id = await useTrainingStore().createProgram(half)
    const { wrapper } = await open(`/training/${id}/session/new`)
    await click(button(wrapper, 'Rest'))
    expect(wrapper.findAll('button').some((b) => b.text() === '+ Add step')).toBe(false)
  })

  it('locks the steps while the session has unsaved changes, so none get lost', async () => {
    const { edit } = await runWalk()
    const { wrapper, router } = await open(edit)
    await wrapper.get('#session-title').setValue('Changed')
    expect(wrapper.get('.steps__locked').text()).toContain(
      'Tap Save first, then you can edit its steps.',
    )
    expect(button(wrapper, '+ Add step').attributes('disabled')).toBeDefined()
    await click(wrapper.findAll('.step__main')[0]!)
    expect(router.currentRoute.value.name).toBe('session-edit')
  })

  it('adds a walk step with a time, and a step inside the repeat', async () => {
    const { edit } = await runWalk()
    const { wrapper, router } = await open(edit)
    await click(button(wrapper, '+ Add step'))
    expect(router.currentRoute.value.name).toBe('step-new')
    await click(button(wrapper, 'Walk'))
    await click(button(wrapper, 'Time'))
    await wrapper.get('#step-target-value').setValue('3:30')
    await click(button(wrapper, 'Save'))
    expect(router.currentRoute.value.name).toBe('session-edit')
    expect(stepTexts(wrapper).slice(-1)[0]).toBe('Walk 3:30')

    await click(button(wrapper, '+ Add step to repeat'))
    expect(wrapper.text()).toContain('New step in repeat')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Repeat')).toBe(false)
    await click(button(wrapper, 'Save'))
    expect(stepTexts(wrapper)).toContain('6× · 3 steps')
  })

  it('starts a new repeat with one run step', async () => {
    const { base } = await runWalk()
    const { wrapper } = await open(`${base}/step/new`)
    await click(button(wrapper, 'Repeat'))
    await click(button(wrapper, '+'))
    await click(button(wrapper, 'Save'))
    // With the time of the session's last run
    expect(stepTexts(wrapper).slice(-2)).toEqual(['3× · 1 step', 'Run 1:00'])
  })

  it('shows a broken rule instead of saving, and keeps a repeat a repeat', async () => {
    const { base, training, sid } = await runWalk()
    const { wrapper } = await open(`${base}/step/run`)
    expect(button(wrapper, 'Run').attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Repeat')).toBe(false)
    await click(button(wrapper, '+ Add pace'))
    await wrapper.get('[aria-label="Fastest pace"]').setValue('5:30')
    await wrapper.get('[aria-label="Slowest pace"]').setValue('5:00')
    await click(button(wrapper, 'Save'))
    expect(wrapper.get('[role="alert"]').text()).toContain('the faster pace comes first')
    await wrapper.get('[aria-label="Slowest pace"]').setValue('5:x')
    await click(button(wrapper, 'Save'))
    expect(wrapper.get('[role="alert"]').text()).toContain('min:s per km')
    expect((await training.loadSteps(sid)).find((s) => s.id === 'run')!.paceMin).toBeNull()

    const repeat = await open(`${base}/step/rep`)
    expect(repeat.wrapper.find('.step-kind--locked').text()).toBe('Repeat')
    expect(repeat.wrapper.text()).toContain('Repeats its 2 steps.')
  })

  it('deletes a repeat with its steps, and the last step of a repeat with the repeat', async () => {
    const { base, training, sid } = await runWalk()
    const first = await open(`${base}/step/run`)
    await click(button(first.wrapper, 'Delete step'))
    expect(first.wrapper.text()).toContain('It is removed from the session.')
    await click(button(first.wrapper, 'Delete'))
    expect((await training.loadSteps(sid)).map((s) => s.id)).toEqual(['warm', 'rep', 'walk'])

    document.body.innerHTML = ''
    const last = await open(`${base}/step/walk`)
    await click(button(last.wrapper, 'Delete step'))
    expect(last.wrapper.text()).toContain("the repeat's last step, so the repeat goes too")
    await click(button(last.wrapper, 'Delete'))
    expect((await training.loadSteps(sid)).map((s) => s.id)).toEqual(['warm'])
  })

  it('asks before a session with steps becomes a rest day', async () => {
    const { edit, training, sid } = await runWalk()
    const { wrapper, router } = await open(edit)
    await click(button(wrapper, 'Rest'))
    await click(wrapper.findAll('button').filter((b) => b.text() === 'Save')[0]!)
    expect(wrapper.text()).toContain('Its 4 steps go too.')
    expect(await training.loadSteps(sid)).toHaveLength(4)
    await click(button(wrapper, 'Make rest day'))
    // Opened directly, the editor goes back to the session view (#147)
    expect(router.currentRoute.value.name).toBe('session')
    expect(wrapper.text()).toContain('Rest · Week 1')
    expect(wrapper.text()).not.toContain('Steps')
    expect(await training.loadSteps(sid)).toEqual([])
  })

  it('says a step is gone when it, its session or its repeat no longer exists', async () => {
    const { base, id } = await runWalk()
    for (const path of [
      `${base}/step/missing`,
      `${base}/step/new?repeat=missing`,
      `/training/${id}/session/new/step/new`,
    ]) {
      document.body.innerHTML = ''
      const { wrapper } = await open(path)
      expect(wrapper.text()).toContain('This step no longer exists')
    }
  })
})

describe('building a session by picking (#143)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  const pressed = (wrapper: Wrapper) =>
    wrapper.findAll('button[aria-pressed="true"]').map((b) => b.text())
  const value = (wrapper: Wrapper) =>
    (wrapper.get('#step-target-value').element as HTMLInputElement).value
  const stepTexts = (wrapper: Wrapper) => wrapper.findAll('.step__text').map((s) => s.text())

  it('builds warm-up 5:00, 8× (run 1:00, walk 1:30), cool-down 5:00 with taps only', async () => {
    const training = useTrainingStore()
    const id = await training.createProgram(half)
    const { wrapper, router } = await open(`/training/${id}`)
    // Every tap is counted; nothing is typed (no setValue in this test)
    let taps = 0
    const tap = async (label: string) => {
      taps++
      const target =
        label === '+ Add session to week 1' ? link(wrapper, label) : button(wrapper, label)
      await click(target)
    }

    await tap('+ Add session to week 1')
    await tap('Run/walk')
    expect(wrapper.get('#session-title').attributes('placeholder')).toBe('Run/walk')
    await tap('+ Add step')
    expect(router.currentRoute.value.name).toBe('step-new')
    expect(pressed(wrapper)).toEqual(['Warm-up', 'Time'])
    expect(value(wrapper)).toBe('')
    await tap('5:00')
    expect(pressed(wrapper)).toEqual(['Warm-up', 'Time', '5:00'])
    await tap('+ Save and add next')
    expect(pressed(wrapper)).toEqual(['Run', 'Time'])
    await tap('Repeat')
    for (let i = 0; i < 6; i++) await tap('+')
    expect(wrapper.get('.stepper__value').text()).toBe('8×')
    await tap('+ Save and add next')
    expect(wrapper.find('h1').text()).toBe('New step in repeat')
    expect(pressed(wrapper)).toEqual(['Run', 'Time'])
    await tap('1:00')
    await tap('+ Save and add next')
    expect(pressed(wrapper)).toEqual(['Walk', 'Time'])
    await tap('1:30')
    await tap('Save')
    expect(router.currentRoute.value.name).toBe('session-edit')
    await tap('+ Add step')
    expect(pressed(wrapper)).toEqual(['Cool-down', 'Time'])
    await tap('5:00')
    await tap('Save')

    expect(stepTexts(wrapper)).toEqual([
      'Warm-up 5:00',
      '8× · 2 steps',
      'Run 1:00',
      'Walk 1:30',
      'Cool-down 5:00',
    ])
    expect(wrapper.get('#session-title').attributes('placeholder')).toBe('8× run 1:00 / walk 1:30')
    await tap('‹ Cancel')
    // Opened without history here, the editor falls back to the session view (#147)
    expect(router.currentRoute.value.name).toBe('session')
    expect(wrapper.get('h1').text()).toBe('8× run 1:00 / walk 1:30')
    // Before #143: 29 taps and 5 typed fields (title, four times), the session saved first
    expect(taps).toBe(21)
  })

  /** A program with a run/walk session: 4× (run 1:00, walk 2:00), no title of its own */
  async function untitled() {
    const training = useTrainingStore()
    const id = await training.createProgram(half)
    const sid = await training.saveSession(id, { week: 1, type: 'runwalk', title: '', notes: null })
    const step = (sid: string, kind: 'run' | 'walk', seconds: number): StepBlock['step'] => ({
      id: crypto.randomUUID(),
      sessionId: sid,
      position: 0,
      kind,
      targetKind: 'duration',
      targetValue: seconds,
      paceMin: null,
      paceMax: null,
      repetitions: null,
      span: null,
    })
    await training.saveBlocks(sid, [
      {
        step: {
          ...step(sid, 'run', 1),
          kind: 'repeat',
          targetKind: 'none',
          targetValue: null,
          repetitions: 4,
        },
        children: [step(sid, 'run', 60), step(sid, 'walk', 120)],
      },
    ])
    return { training, id, sid }
  }

  it('names sessions without a title from their steps, and a typed title wins', async () => {
    const { training, id, sid } = await untitled()
    await training.saveSession(id, { week: 1, type: 'easy', title: '', notes: null })
    await training.saveSession(id, { week: 2, type: 'rest', title: '', notes: null })
    const { wrapper } = await open(`/training/${id}`)
    const rows = () => wrapper.findAll('.row').map((r) => r.find('.session__title').text())
    // No steps: the type only, not "Easy Easy"; a rest day stays "Rest" once
    expect(rows()).toEqual(['4× run 1:00 / walk 2:00', '', ''])

    // The session view (#147) is headed by the generated name, and so is the remove dialog (#150)
    await click(link(wrapper, '4× run 1:00 / walk 2:00'))
    expect(wrapper.get('h1').text()).toBe('4× run 1:00 / walk 2:00')
    await click(link(wrapper, 'Edit'))
    expect(wrapper.get('#session-title').attributes('placeholder')).toBe('4× run 1:00 / walk 2:00')
    await click(button(wrapper, 'Remove from program'))
    expect(wrapper.find('[role="alertdialog"]').text()).toContain(
      'Remove 4× run 1:00 / walk 2:00 from week 1?',
    )
    await click(button(wrapper, 'Keep'))
    await wrapper.get('#session-title').setValue('Day 1')
    await click(wrapper.findAll('button').filter((b) => b.text() === 'Save')[0]!)
    expect((await training.getSession(sid))!.title).toBe('Day 1')
    expect(wrapper.get('h1').text()).toBe('Day 1')
  })

  it('follows step edits in the generated name', async () => {
    const { training, id, sid } = await untitled()
    const blocks = await training.loadBlocks(sid)
    const run = blocks[0]!.children[0]!
    const { wrapper } = await open(`/training/${id}/session/${sid}/step/${run.id}`)
    await click(button(wrapper, '2:00'))
    await click(button(wrapper, 'Save'))
    expect(wrapper.get('#session-title').attributes('placeholder')).toBe('4× run 2:00 / walk 2:00')
  })

  it('shows one message when the steps cannot be read, and leaves the planned amounts out (#138)', async () => {
    const memory = createMemoryTrainingRepository()
    const training = useTrainingStore()
    training.useRepository(memory)
    const { id } = await untitled()
    training.useRepository({
      ...memory,
      loadProgramSteps: async () => {
        throw new Error('broken')
      },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { wrapper } = await open(`/training/${id}`)
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(1)
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'Could not read the steps; names and planned amounts may be missing',
    )
    // The type stands in for the name, and the week line has no planned minutes
    expect(wrapper.get('.session__type').text()).toBe('Run/walk')
    expect(wrapper.get('.session__title').text()).toBe('')
    expect(wrapper.get('.week__summary').text()).toBe('0 of 1 session')
    warn.mockRestore()

    training.useRepository(memory)
    document.body.innerHTML = ''
    const ok = await open(`/training/${id}`)
    expect(ok.wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(ok.wrapper.get('.week__summary').text()).toBe('0 of 1 session · 0 of 12 min')
  })

  it('makes the target follow the kind on a new step, until it is picked by hand', async () => {
    const { id, sid } = await untitled()
    const { wrapper } = await open(`/training/${id}/session/${sid}/step/new`)
    // After the repeat: cool-down, no earlier one to copy
    expect(pressed(wrapper)).toEqual(['Cool-down', 'Time'])
    await click(button(wrapper, 'Walk'))
    expect(value(wrapper)).toBe('2:00')
    expect(pressed(wrapper)).toEqual(['Walk', 'Time', '2:00'])
    await click(button(wrapper, 'Run'))
    expect(value(wrapper)).toBe('1:00')
    await click(button(wrapper, 'Distance'))
    await click(button(wrapper, '400 m'))
    expect(value(wrapper)).toBe('400')
    await click(button(wrapper, 'Walk'))
    expect(pressed(wrapper)).toEqual(['Walk', 'Distance', '400 m'])
    // A typed value matching a chip presses it; any other presses none
    await wrapper.get('#step-target-value').setValue('800')
    expect(pressed(wrapper)).toEqual(['Walk', 'Distance', '800 m'])
    await wrapper.get('#step-target-value').setValue('750')
    expect(pressed(wrapper)).toEqual(['Walk', 'Distance'])
    expect(wrapper.get('#step-target-value').attributes('placeholder')).toBe('metres')
    await click(button(wrapper, 'Time'))
    expect(wrapper.get('#step-target-value').attributes('placeholder')).toBe('min:s')
  })

  it('stays inside the repeat on "Save and add next"', async () => {
    const { training, id, sid } = await untitled()
    const repeat = (await training.loadBlocks(sid))[0]!.step.id
    const { wrapper } = await open(`/training/${id}/session/${sid}/step/new?repeat=${repeat}`)
    expect(pressed(wrapper)).toEqual(['Run', 'Time', '1:00'])
    await click(button(wrapper, '+ Save and add next'))
    expect(wrapper.find('h1').text()).toBe('New step in repeat')
    expect(pressed(wrapper)).toEqual(['Walk', 'Time', '2:00'])
    await click(button(wrapper, '+ Save and add next'))
    const blocks = await training.loadBlocks(sid)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.children.map((c) => [c.kind, c.targetValue])).toEqual([
      ['run', 60],
      ['walk', 120],
      ['run', 60],
      ['walk', 120],
    ])
  })

  it('keeps the pace folded until "+ Add pace", open on a step that has one', async () => {
    const { training, id, sid } = await untitled()
    const { wrapper } = await open(`/training/${id}/session/${sid}/step/new`)
    expect(wrapper.find('[aria-label="Fastest pace"]').exists()).toBe(false)
    await click(button(wrapper, '5:00'))
    await click(button(wrapper, '+ Add pace'))
    expect(document.activeElement).toBe(wrapper.get('[aria-label="Fastest pace"]').element)
    expect(wrapper.get('[aria-label="Fastest pace"]').attributes('placeholder')).toBe('min:s')
    await wrapper.get('[aria-label="Fastest pace"]').setValue('5:30')
    await wrapper.get('[aria-label="Slowest pace"]').setValue('6:00')
    await click(button(wrapper, 'Save'))
    const saved = (await training.loadSteps(sid)).slice(-1)[0]!
    expect([saved.paceMin, saved.paceMax]).toEqual([330, 360])

    document.body.innerHTML = ''
    const edit = await open(`/training/${id}/session/${sid}/step/${saved.id}`)
    expect(edit.wrapper.findAll('button').some((b) => b.text() === '+ Save and add next')).toBe(
      false,
    )
    expect(
      (edit.wrapper.get('[aria-label="Fastest pace"]').element as HTMLInputElement).value,
    ).toBe('5:30')
    await click(button(edit.wrapper, 'Remove pace'))
    expect(edit.wrapper.find('[aria-label="Fastest pace"]').exists()).toBe(false)
    await click(button(edit.wrapper, 'Save'))
    const cleared = (await training.loadSteps(sid)).slice(-1)[0]!
    expect([cleared.paceMin, cleared.paceMax]).toEqual([null, null])
  })

  it('shows "e.g." hints on the program form', async () => {
    const { wrapper } = await open('/training/new')
    expect(wrapper.get('#program-name').attributes('placeholder')).toBe('e.g. Half marathon')
    expect(wrapper.get('#program-goal').attributes('placeholder')).toBe('e.g. Sub 2:00')
  })
})
