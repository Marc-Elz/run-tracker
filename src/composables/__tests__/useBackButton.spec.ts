import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useBackButton, useBackInterceptor } from '../useBackButton'

const native = vi.hoisted(() => ({
  isNative: true,
  handler: null as (() => void) | null,
  remove: vi.fn<() => void>(),
  minimizeApp: vi.fn<() => Promise<void>>(async () => {}),
  exitApp: vi.fn<() => Promise<void>>(async () => {}),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.isNative } }))
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (_event: string, handler: () => void) => {
      native.handler = handler
      return { remove: native.remove }
    },
    minimizeApp: native.minimizeApp,
    exitApp: native.exitApp,
  },
}))

const Empty = { template: '<div />' }

async function setup(runActive: boolean, path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'run', component: Empty },
      { path: '/history', name: 'history', component: Empty },
    ],
  })
  await router.push(path)
  const active = ref(runActive)
  const wrapper = mount(
    defineComponent({
      setup() {
        useBackButton(router, active)
      },
      template: '<div />',
    }),
    { global: { plugins: [router] } },
  )
  return { router, wrapper }
}

describe('useBackButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    native.isNative = true
    native.handler = null
  })

  it('goes back to the Run tab from another tab', async () => {
    const { router } = await setup(false, '/history')
    native.handler!()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('run'))
    expect(native.exitApp).not.toHaveBeenCalled()
  })

  it('closes the app from the Run tab when no run is on', async () => {
    await setup(false, '/')
    native.handler!()
    expect(native.exitApp).toHaveBeenCalled()
    expect(native.minimizeApp).not.toHaveBeenCalled()
  })

  it('sends the app to the background during a run, so the GPS service keeps going', async () => {
    await setup(true, '/')
    native.handler!()
    expect(native.minimizeApp).toHaveBeenCalled()
    expect(native.exitApp).not.toHaveBeenCalled()
  })

  it('removes the listener when unmounted, and does nothing in the browser', async () => {
    const { wrapper } = await setup(false, '/')
    wrapper.unmount()
    await vi.waitFor(() => expect(native.remove).toHaveBeenCalled())

    native.isNative = false
    native.handler = null
    await setup(false, '/')
    expect(native.handler).toBeNull()
  })

  it('closes what a screen has open before leaving it, newest first', async () => {
    const { router } = await setup(false, '/history')
    const open = ref(true)
    const onBack = vi.fn<() => void>(() => {
      open.value = false
    })
    const screen = mount(
      defineComponent({
        setup() {
          useBackInterceptor(open, onBack)
        },
        template: '<div />',
      }),
    )

    native.handler!()
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('history')

    // Closed now, so back leaves the screen as usual
    native.handler!()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('run'))

    // An unmounted screen no longer intercepts
    open.value = true
    screen.unmount()
    await router.push('/history')
    native.handler!()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('run'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
