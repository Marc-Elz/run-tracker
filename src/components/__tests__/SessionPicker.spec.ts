import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { unavailableTrainingRepository } from '@/lib/db/trainingRepository'
import { setFollowedProgram } from '@/lib/settings'
import { useTrainingStore } from '@/stores/training'
import SessionPicker from '../SessionPicker.vue'

enableAutoUnmount(afterEach)

/** Two programs: the followed one with two sessions, another with one */
async function programs() {
  const training = useTrainingStore()
  const base = { goal: null, weeks: 2, startDate: null }
  const followed = await training.createProgram({ ...base, name: 'Beginner' })
  const first = await training.saveSession(followed, {
    week: 1,
    type: 'runwalk',
    title: 'Week 1 run/walk',
    notes: null,
  })
  await training.saveSession(followed, { week: 2, type: 'easy', title: 'Easy 20', notes: null })
  const other = await training.createProgram({ ...base, name: 'Half marathon' })
  const tempo = await training.saveSession(other, {
    week: 1,
    type: 'tempo',
    title: 'Tempo 3 km',
    notes: null,
  })
  setFollowedProgram(followed)
  return { followed, first, other, tempo }
}

const titles = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('.choice__title').map((t) => t.text())

describe('SessionPicker', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setFollowedProgram(null)
  })

  it("reports a pick, and whether it is the followed program's next session", async () => {
    const { first } = await programs()
    const wrapper = mount(SessionPicker, { props: { title: 'Choose a session' } })
    await flushPromises()
    expect(titles(wrapper)).toEqual(['Week 1 run/walk', 'Easy 20'])
    await wrapper.find('.choice').trigger('click')
    expect(wrapper.emitted('pick')).toEqual([[first, true]])
  })

  it('switches program, without a "Next" mark outside the followed one', async () => {
    const { other, tempo } = await programs()
    const wrapper = mount(SessionPicker, { props: { title: 'Choose a session' } })
    await flushPromises()
    await wrapper.find('select').setValue(other)
    await flushPromises()
    expect(titles(wrapper)).toEqual(['Tempo 3 km'])
    expect(wrapper.find('.choice__mark--next').exists()).toBe(false)
    await wrapper.find('.choice').trigger('click')
    expect(wrapper.emitted('pick')).toEqual([[tempo, false]])
  })

  it('neither picks nor closes while the parent is busy, and shows its error', async () => {
    await programs()
    const wrapper = mount(SessionPicker, {
      props: { title: 'Link to a session', busy: true, error: 'Could not link the run.' },
    })
    await flushPromises()
    await wrapper.find('.choice').trigger('click')
    await wrapper.find('.backdrop').trigger('click')
    expect(wrapper.emitted('pick')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.find('[role="alert"]').text()).toBe('Could not link the run.')
  })

  it('says so when the sessions cannot be read, and still closes', async () => {
    useTrainingStore().useRepository(unavailableTrainingRepository('broken'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wrapper = mount(SessionPicker, { props: { title: 'Choose a session' } })
    await flushPromises()
    expect(wrapper.text()).toContain('Could not read the sessions.')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Cancel')!
      .trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
