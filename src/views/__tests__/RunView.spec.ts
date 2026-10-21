import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import RunView from '../RunView.vue'

vi.mock('@capacitor-community/keep-awake', () => ({
  KeepAwake: {
    isSupported: async () => ({ isSupported: false }),
    keepAwake: async () => {},
    allowSleep: async () => {},
  },
}))

const button = (wrapper: ReturnType<typeof mount>, label: string) =>
  wrapper.findAll('button').find((b) => b.text() === label)

describe('RunView', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('walks through start, pause, resume and stop', async () => {
    const wrapper = mount(RunView)
    expect(wrapper.text()).toContain('00:00')

    await button(wrapper, 'Start')!.trigger('click')
    expect(wrapper.attributes('data-status')).toBe('running')
    expect(button(wrapper, 'Stop')).toBeUndefined() // can't stop by accident mid-run

    await button(wrapper, 'Pause')!.trigger('click')
    expect(wrapper.attributes('data-status')).toBe('paused')

    await button(wrapper, 'Resume')!.trigger('click')
    expect(wrapper.attributes('data-status')).toBe('running')

    await button(wrapper, 'Pause')!.trigger('click')
    await button(wrapper, 'Stop')!.trigger('click')
    expect(wrapper.attributes('data-status')).toBe('finished')

    await button(wrapper, 'Done')!.trigger('click')
    expect(wrapper.attributes('data-status')).toBe('idle')
  })
})
