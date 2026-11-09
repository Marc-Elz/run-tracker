import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { routes } from '@/router'
import { useTrainingStore } from '@/stores/training'
import { unavailableTrainingRepository } from '@/lib/db/trainingRepository'

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

  it('edits a session and deletes it after asking', async () => {
    const training = useTrainingStore()
    const id = await training.createProgram(half)
    const sid = await training.saveSession(id, {
      week: 1,
      type: 'easy',
      title: 'Easy',
      notes: null,
    })
    const { wrapper } = await open(`/training/${id}/session/${sid}`)
    expect((wrapper.get('#session-title').element as HTMLInputElement).value).toBe('Easy')
    await wrapper.get('#session-notes').setValue('Flat route')
    await click(button(wrapper, 'Save'))
    expect((await training.getSession(sid))!.notes).toBe('Flat route')

    await click(link(wrapper, 'Easy'))
    await click(button(wrapper, 'Delete session'))
    expect(document.body.textContent).toContain('Delete this session?')
    await click(button(wrapper, 'Delete'))
    expect(await training.getSession(sid)).toBeNull()
    expect(wrapper.findAll('.empty-week')).toHaveLength(3)
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
