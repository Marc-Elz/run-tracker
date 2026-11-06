import { describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useBackButton } from '../useBackButton'
import { useLeaveScreen } from '../useLeaveScreen'

const native = vi.hoisted(() => ({ handler: null as (() => void) | null }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (_event: string, handler: () => void) => {
      native.handler = handler
      return { remove: () => {} }
    },
    minimizeApp: async () => {},
    exitApp: async () => {},
  },
}))

const Empty = { template: '<div />' }

async function setup() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'run', component: Empty },
      { path: '/training', name: 'training', component: Empty },
      { path: '/training/new', name: 'program-new', component: Empty },
    ],
  })
  await router.push('/training/new')
  const busy = ref(false)
  let leave = () => {}
  mount(
    defineComponent({
      setup() {
        useBackButton(router, ref(false))
        leave = useLeaveScreen(() => ({ name: 'training' }), busy)
      },
      template: '<div />',
    }),
    { global: { plugins: [router] } },
  )
  await flushPromises()
  const replace = vi.spyOn(router, 'replace')
  return { router, busy, leave: () => leave(), replace }
}

describe('useLeaveScreen', () => {
  it('goes up to the parent on Android back instead of to the Run tab', async () => {
    const { router } = await setup()
    native.handler!()
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('training')
  })

  it('ignores Android back while a save is in flight, and leaves only once after it', async () => {
    const { router, busy, leave, replace } = await setup()
    busy.value = true
    native.handler!()
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('program-new')

    // The save succeeds and leaves; a second request (say, a late back) does nothing more
    leave()
    leave()
    await flushPromises()
    expect(replace).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.name).toBe('training')
  })
})
