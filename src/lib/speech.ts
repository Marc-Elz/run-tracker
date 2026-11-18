import { TextToSpeech } from '@capacitor-community/text-to-speech'
import { abandonAudioFocus, requestAudioFocus } from '@/lib/runPower'

/** No cue runs this long; past it a line counts as over even if the engine never said so */
const MAX_LINE_MS = 10_000

/**
 * The line now being spoken. The plugin flushes: a new line cuts the old one off, and the old
 * one's promise then never settles. So only the newest line counts, with a time cap.
 */
let current: { id: number; startedAt: number } | null = null
let nextId = 0

/** Is a line being spoken? Lets a lower-priority cue (#103) wait instead of cutting it off. */
export function isSpeaking(now = Date.now()): boolean {
  return current !== null && now - current.startedAt < MAX_LINE_MS
}

/**
 * Speak a line, lowering other audio meanwhile. Never throws: no speech engine or a muted phone
 * must not disturb the run.
 */
export async function speak(text: string): Promise<void> {
  const id = ++nextId
  current = { id, startedAt: Date.now() }
  try {
    await requestAudioFocus()
    await TextToSpeech.speak({ text, lang: 'en-US' })
  } catch (err) {
    console.warn('Speech unavailable', err)
  } finally {
    if (current?.id === id) current = null
    await abandonAudioFocus()
  }
}
