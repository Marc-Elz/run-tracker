import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useRunStore } from '@/stores/run'
import router from '@/router'
import App from '../App.vue'

vi.mock('@capacitor-community/keep-awake', () => ({
  KeepAwake: {
    isSupported: async () => ({ isSupported: false }),
    keepAwake: async () => {},
    allowSleep: async () => {},
  },
}))

describe('App shell', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await router.push('/')
  })

  const mountApp = () => mount(App, { global: { plugins: [router] } })

  it('shows the tab bar and switches screens', async () => {
    const wrapper = mountApp()
    const nav = wrapper.find('nav')
    expect(nav.findAll('a').map((a) => a.text())).toEqual(['Run', 'History', 'Settings'])
    await nav.findAll('a')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('History')
    expect(router.currentRoute.value.name).toBe('history')
  })

  it('hides the tab bar from Start until Done', async () => {
    const run = useRunStore()
    const wrapper = mountApp()
    run.start(0)
    await flushPromises()
    expect(wrapper.find('nav').exists()).toBe(false)
    run.stop(1000)
    await flushPromises()
    expect(wrapper.find('nav').exists()).toBe(false) // finished screen, until Done
    run.reset()
    await flushPromises()
    expect(wrapper.find('nav').exists()).toBe(true)
  })
})
