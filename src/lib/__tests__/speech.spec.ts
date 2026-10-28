import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  speak: vi.fn<(o: { text: string }) => Promise<void>>(async () => {}),
  requestAudioFocus: vi.fn<() => Promise<void>>(async () => {}),
  abandonAudioFocus: vi.fn<() => Promise<void>>(async () => {}),
}))

vi.mock('@capacitor-community/text-to-speech', () => ({ TextToSpeech: { speak: mocks.speak } }))
vi.mock('@/lib/runPower', () => ({
  requestAudioFocus: mocks.requestAudioFocus,
  abandonAudioFocus: mocks.abandonAudioFocus,
}))

import { speak } from '../speech'

beforeEach(() => vi.clearAllMocks())

describe('speak', () => {
  it('speaks with audio focus held only meanwhile', async () => {
    await speak('1 kilometre')
    expect(mocks.speak).toHaveBeenCalledWith(expect.objectContaining({ text: '1 kilometre' }))
    expect(mocks.requestAudioFocus).toHaveBeenCalledOnce()
    expect(mocks.abandonAudioFocus).toHaveBeenCalledOnce()
  })

  it('swallows a failing speech engine and still gives the focus back', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.speak.mockRejectedValueOnce(new Error('no engine'))
    await expect(speak('x')).resolves.toBeUndefined()
    expect(mocks.abandonAudioFocus).toHaveBeenCalledOnce()
  })
})
