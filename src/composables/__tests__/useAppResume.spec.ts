import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { useAppResume } from '../useAppResume'

const native = vi.hoisted(() => ({
  isNative: true,
  handler: null as ((state: { isActive: boolean }) => void) | null,
  remove: vi.fn<() => void>(),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.isNative } }))
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (_event: string, handler: (state: { isActive: boolean }) => void) => {
      native.handler = handler
      return { remove: native.remove }
    },
  },
}))

const setup = (onResume: () => void) =>
  mount(
    defineComponent({
      setup() {
        useAppResume(onResume)
      },
      template: '<div />',
    }),
  )

describe('useAppResume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    native.isNative = true
    native.handler = null
  })

  it('calls back when the app comes to the foreground, not when it leaves', () => {
    const onResume = vi.fn<() => void>()
    setup(onResume)
    native.handler!({ isActive: false })
    expect(onResume).not.toHaveBeenCalled()
    native.handler!({ isActive: true })
    expect(onResume).toHaveBeenCalledOnce()
  })

  it('removes the listener when unmounted', async () => {
    const wrapper = setup(() => {})
    wrapper.unmount()
    await vi.waitFor(() => expect(native.remove).toHaveBeenCalled())
  })

  it('does nothing in the browser', () => {
    native.isNative = false
    setup(() => {})
    expect(native.handler).toBeNull()
  })
})
