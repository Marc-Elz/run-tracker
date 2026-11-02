import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

/**
 * Hand a file to the user. On the phone: write it to the app cache and open the Android share
 * sheet (Drive, Save to device, Strava ...). In the browser: download it. Closing the share sheet
 * is not an error. The cache file is left for Android to clear: the app the user picked may still
 * be reading it after the sheet closes.
 */
export async function shareFile(fileName: string, text: string, mimeType: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(new Blob([text], { type: mimeType }))
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
    return
  }

  const { uri } = await Filesystem.writeFile({
    path: fileName,
    data: text,
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

/** Hand a GPX file to the user, see `shareFile`. */
export const shareGpx = (fileName: string, xml: string) =>
  shareFile(fileName, xml, 'application/gpx+xml')
