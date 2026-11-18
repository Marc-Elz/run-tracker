import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

const speak = vi.hoisted(() => vi.fn<(t: string) => Promise<void>>(async () => {}))
vi.mock('@/lib/speech', () => ({ speak, isSpeaking: () => false }))
vi.mock('@/lib/haptics', () => ({ vibrateStepChange: async () => {} }))

import { routes } from '@/router'
import { useTrainingStore } from '@/stores/training'
import { setTimerPresets, timerPresets } from '@/lib/settings'
import { unavailableTrainingRepository } from '@/lib/db/trainingRepository'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size
    },
  }
}

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
const click = async (el: { trigger(event: string): Promise<void> }) => {
  await el.trigger('click')
  await flushPromises()
}

const plank = { id: 'p', name: 'Plank set', workS: 45, restS: 15, rounds: 4 }

describe('exercise timer screens', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    vi.stubGlobal('localStorage', memoryStorage())
    setTimerPresets([])
    speak.mockClear()
  })

  it('has a Timer entry on the Training tab, also when programs fail to load', async () => {
    setTimerPresets([plank])
    useTrainingStore().useRepository(unavailableTrainingRepository(new Error('no db')))
    const { wrapper } = await open('/training')
    const row = wrapper.get('.timer-row')
    expect(row.attributes('href')).toBe('/timer')
    expect(row.text()).toContain('2 minutes and 1 more preset')
    expect(wrapper.text()).toContain('Could not load programs')
  })

  it('lists the 2-minute default first and starts it with one tap', async () => {
    setTimerPresets([plank])
    const { wrapper } = await open('/timer')
    const rows = wrapper.findAll('.preset')
    expect(rows[0]!.text()).toContain('2 minutes')
    expect(rows[1]!.text()).toContain('0:45 work · 0:15 rest · 4× · total 3:45')
    await click(wrapper.get('.preset__start'))
    expect(wrapper.get('.countdown__time').text()).toBe('2:00')
    expect(wrapper.get('.countdown__phase').text()).toBe('2 minutes')
    expect(speak).toHaveBeenCalledWith('Go')
    wrapper.unmount()
  })

  it('shows round, phase and what comes next for a set', async () => {
    setTimerPresets([plank])
    const { wrapper } = await open('/timer')
    await click(wrapper.findAll('.preset__start')[1]!)
    expect(wrapper.get('.countdown__phase').text()).toBe('Work')
    expect(wrapper.get('.countdown__round').text()).toBe('Round 1 / 4')
    expect(wrapper.get('.countdown__next').text()).toBe('Next: rest 0:15')
    wrapper.unmount()
  })

  it('pauses, then stops back to the list', async () => {
    const { wrapper } = await open('/timer')
    await click(wrapper.get('.preset__start'))
    await click(button(wrapper, 'Pause'))
    expect(wrapper.get('.countdown__phase').text()).toBe('Paused')
    expect(button(wrapper, 'Resume').exists()).toBe(true)
    await click(button(wrapper, 'Stop'))
    expect(wrapper.find('.countdown').exists()).toBe(false)
    expect(wrapper.text()).toContain('+ New preset')
  })

  it('asks before leaving a running timer', async () => {
    const { wrapper, router } = await open('/timer')
    await click(wrapper.get('.preset__start'))
    await router.push('/history').catch(() => {})
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('timer')
    expect(wrapper.text()).toContain('Stop the timer?')
    await click(button(wrapper, 'Keep'))
    expect(wrapper.text()).not.toContain('Stop the timer?')
    expect(wrapper.find('.countdown').exists()).toBe(true)

    await router.push('/history').catch(() => {})
    await flushPromises()
    await click(wrapper.findAll('.dialog button').find((b) => b.text() === 'Stop')!)
    expect(router.currentRoute.value.name).toBe('history')
  })

  it('creates a preset with picked times and rounds', async () => {
    const { wrapper, router } = await open('/timer/new')
    await click(button(wrapper, '0:45'))
    await click(button(wrapper, '0:15'))
    await click(button(wrapper, '+'))
    await click(button(wrapper, '+'))
    expect(wrapper.get('.stepper__value').text()).toBe('3×')
    expect(wrapper.text()).toContain('Total 2:45 (no rest after the last round)')
    await click(button(wrapper, 'Save'))
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('timer')
    expect(timerPresets.value[1]).toMatchObject({
      name: '0:45 / 0:15 × 3',
      workS: 45,
      restS: 15,
      rounds: 3,
    })
  })

  it('says what is wrong with an unreadable work time', async () => {
    const { wrapper, router } = await open('/timer/new')
    await wrapper.get('#preset-work').setValue('abc')
    await click(button(wrapper, 'Save'))
    expect(wrapper.get('[role=alert]').text()).toContain('at least 0:05')
    expect(router.currentRoute.value.name).toBe('timer-preset-new')
  })

  it('lets the default be edited but not deleted', async () => {
    const { wrapper } = await open('/timer/default/edit')
    expect(wrapper.text()).toContain("This preset can't be deleted.")
    expect(wrapper.findAll('button').some((b) => b.text() === 'Delete preset')).toBe(false)
    await wrapper.get('#preset-work').setValue('3:00')
    await wrapper.get('#preset-name').setValue('3 minutes')
    await click(button(wrapper, 'Save'))
    expect(timerPresets.value[0]).toMatchObject({ id: 'default', name: '3 minutes', workS: 180 })
  })

  it('deletes a preset after asking', async () => {
    setTimerPresets([plank])
    const { wrapper } = await open('/timer/p/edit')
    await click(button(wrapper, 'Delete preset'))
    expect(wrapper.text()).toContain('Delete Plank set?')
    await click(wrapper.findAll('.dialog button').find((b) => b.text() === 'Delete')!)
    expect(timerPresets.value.map((p) => p.id)).toEqual(['default'])
  })

  it('says so when the preset no longer exists', async () => {
    const { wrapper } = await open('/timer/gone/edit')
    expect(wrapper.text()).toContain('This preset no longer exists')
  })
})
