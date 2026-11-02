import { TextToSpeech } from '@capacitor-community/text-to-speech'
import { abandonAudioFocus, requestAudioFocus } from '@/lib/runPower'

/**
 * Speak a line, lowering other audio meanwhile. Never throws: no speech engine or a muted phone
 * must not disturb the run.
 */
export async function speak(text: string): Promise<void> {
  try {
    await requestAudioFocus()
    await TextToSpeech.speak({ text, lang: 'en-GB' })
  } catch (err) {
    console.warn('Speech unavailable', err)
  } finally {
    await abandonAudioFocus()
  }
}
