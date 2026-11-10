import { Haptics } from '@capacitor/haptics'

/** Buzz at a step change, a backup when the voice can't be heard. Never throws. */
export async function vibrateStepChange(): Promise<void> {
  try {
    await Haptics.vibrate({ duration: 400 })
  } catch (err) {
    console.warn('Vibration unavailable', err)
  }
}
