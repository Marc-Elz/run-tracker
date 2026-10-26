import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

/**
 * Hand a GPX file to the user. On the phone: write it to the app cache and open the Android share
 * sheet (Drive, Save to device, Strava ...). In the browser: download it. Closing the share sheet
 * is not an error.
 */
export async function shareGpx(fileName: string, xml: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/gpx+xml' }))
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
    return
  }

  const { uri } = await Filesystem.writeFile({
    path: fileName,
    data: xml,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  })
  try {
    await Share.share({ title: fileName, files: [uri] })
  } catch (err) {
    // The plugin rejects when the sheet is dismissed
    if (err instanceof Error && /cancel/i.test(err.message)) return
    throw err
  }
}
