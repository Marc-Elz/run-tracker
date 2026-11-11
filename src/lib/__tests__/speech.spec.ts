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

import { isSpeaking, speak } from '../speech'

beforeEach(() => vi.clearAllMocks())

describe('speak', () => {
  it('speaks with audio focus held only meanwhile', async () => {
    await speak('1 kilometre')
    expect(mocks.speak).toHaveBeenCalledWith(expect.objectContaining({ text: '1 kilometre', lang: 'en-US' }))
    expect(mocks.requestAudioFocus).toHaveBeenCalledOnce()
    expect(mocks.abandonAudioFocus).toHaveBeenCalledOnce()
  })

  it('swallows a failing speech engine and still gives the focus back', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.speak.mockRejectedValueOnce(new Error('no engine'))
    await expect(speak('x')).resolves.toBeUndefined()
    expect(mocks.abandonAudioFocus).toHaveBeenCalledOnce()
  })

  it('is speaking while the newest line plays, also when an older one was cut off (#103)', async () => {
    let finish = () => {}
    // The first line is cut off by the second and never settles, like the plugin's flush
    mocks.speak.mockImplementationOnce(() => new Promise<void>(() => {}))
    mocks.speak.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)))
    void speak('Run, 1 minute')
    await vi.waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(1))
    const second = speak('Faster')
    await vi.waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(2))
    expect(isSpeaking()).toBe(true)
    finish()
    await second
    expect(isSpeaking()).toBe(false)
  })

  it('stops counting a line as playing after 10 s, in case the engine never answers', async () => {
    mocks.speak.mockImplementationOnce(() => new Promise<void>(() => {}))
    void speak('lost')
    expect(isSpeaking()).toBe(true)
    expect(isSpeaking(Date.now() + 10_001)).toBe(false)
  })
})
